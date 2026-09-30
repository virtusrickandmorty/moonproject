import { describe, expect, it } from 'vitest';
import { newId } from '@moonproject/shared';
import { createTestEnv, idem } from '../../../../test/helpers.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { postJournal } from '../../../engine/ledger/post.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

async function jobOrder(env: Awaited<ReturnType<typeof createTestEnv>>, customerId: string, dueInDays = 15) {
  const encoder = await env.as('encoder');
  const res = await encoder.post('/api/docs/jo.job_order/post', { input: {
    customerId, dueInDays, priority: 'normal', paymentTerms: 'dp50',
    lines: [{ kind: 'made_to_order', description: 'Made-up shirts', qty: 1, unitPriceCents: 100_000, discountCents: 0, roster: [] }],
  }, expectedTotalCents: 100_000 }, idem());
  expect(res.statusCode, res.body).toBe(200);
  return res.json().id as string;
}

describe('DASH role homes and notifications', () => {
  it('gives each role its own permitted home', async () => {
    const env = await createTestEnv();
    const [encoder, accountant, owner, production] = await Promise.all([env.as('encoder'), env.as('accountant'), env.as('owner'), env.as('production')]);
    const homes = await Promise.all([encoder, accountant, owner, production].map(async (client) => {
      const res = await client.get('/api/dash/home');
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as { role: string; widgets: { key: string }[] };
    }));
    expect(homes.map((h) => h.role)).toEqual(['encoder', 'accountant', 'owner', 'production']);
    expect(homes[0]!.widgets.map((w) => w.key)).toEqual(['drafts', 'due', 'ready', 'collectibles', 'production']);
    expect(homes[1]!.widgets.map((w) => w.key)).toEqual(['drafts', 'exceptions']);
    expect(homes[2]!.widgets.map((w) => w.key)).toEqual(['overdue-collectibles', 'cash', 'sales', 'collections', 'cancellations']);
    expect(homes[3]!.widgets.map((w) => w.key)).toEqual(['production']);
    env.db.close();
  });

  it('chooses homes by grants, including a grant on a different role', async () => {
    const env = await createTestEnv();
    const encoder = await env.as('encoder');
    const owner = await env.as('owner');
    env.db.prepare("UPDATE role_permissions SET granted = 1 WHERE role_key = 'encoder' AND permission_key = 'dash.home.accountant'").run();
    expect((await encoder.get('/api/dash/home')).json().role).toBe('accountant');
    env.db.prepare("UPDATE role_permissions SET granted = 0 WHERE role_key = 'owner' AND permission_key = 'dash.home.owner'").run();
    expect((await owner.get('/api/dash/home')).json().role).toBe('encoder');
    env.db.close();
  });

  it('hides negative cash at a place whose balance the encoder may not see', async () => {
    const env = await createTestEnv();
    const encoder = await env.as('encoder');
    const owner = await env.as('owner');
    const placeRes = await owner.post('/api/cash/places', { name: 'Hidden test safe', kind: 'cash', encoderSeesBalance: false });
    expect(placeRes.statusCode, placeRes.body).toBe(200);
    const place = placeRes.json() as { id: number; name: string };
    tx(env.db, () => postJournal(env.db, { memo: 'Test negative balance', lines: [
      { account: { role: 'CASH_SHORT_OVER' }, debitCents: 100 },
      { account: { cashPlace: place.id }, creditCents: 100 },
    ] }, { sourceType: 'test', sourceId: newId(), businessDate: today(env.clock), userId: owner.userId, at: stamp(env.clock) }));
    const ownerHome = (await owner.get('/api/dash/home')).json();
    expect(ownerHome.widgets.find((w: { key: string }) => w.key === 'cash').items).toContainEqual(expect.objectContaining({ label: place.name, amountCents: -100 }));
    expect((await owner.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining({ kind: 'negative-cash', amountCents: -100 }));
    expect((await encoder.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'negative-cash', amountCents: -100 }));
    expect(JSON.stringify((await encoder.get('/api/dash/home')).json())).not.toContain(place.name);
    env.db.close();
  });

  it('keeps per-user read state and drops a notice when its permission is removed', async () => {
    const env = await createTestEnv();
    const encoder = await env.as('encoder');
    const owner = await env.as('owner');
    const draft = await encoder.post('/api/drafts', { docType: 'quo.quotation', payload: {} });
    expect(draft.statusCode, draft.body).toBe(200);
    env.db.prepare("UPDATE drafts SET created_at = '2026-09-23T10:00:00.000+08:00' WHERE id = ?").run(draft.json().id);
    const first = (await encoder.get('/api/dash/notifications')).json() as { id: string; kind: string; read: boolean }[];
    const old = first.find((n) => n.kind === 'old-draft');
    expect(old).toMatchObject({ read: false, label: 'Quotation draft waiting over 3 days' });
    const home = (await encoder.get('/api/dash/home')).json();
    expect(home.widgets.find((w: { key: string }) => w.key === 'drafts').items).toContainEqual(expect.objectContaining({ label: 'Quotation' }));
    expect((await owner.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ id: old!.id }));
    expect((await encoder.post('/api/dash/notifications/read', { id: old!.id })).statusCode).toBe(200);
    expect((await encoder.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining({ id: old!.id, read: true }));
    env.db.prepare("UPDATE role_permissions SET granted = 0 WHERE role_key = 'encoder' AND permission_key = 'quo.create'").run();
    expect((await encoder.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ id: old!.id }));
    expect((await encoder.post('/api/dash/notifications/read', { id: old!.id })).statusCode).toBe(404);
    env.db.close();
  });

  it('shows cancellations and reissues by the change permission and document view permission', async () => {
    const env = await createTestEnv();
    const encoder = await env.as('encoder');
    const accountant = await env.as('accountant');
    const owner = await env.as('owner');
    const cash = (env.db.prepare("SELECT id FROM accounts WHERE code = '1101'").pluck().get()) as number;
    const posted = await encoder.post('/api/docs/cash.other_receipt/post', { input: {
      cashPlaceId: cash, category: 'other_income', receivedFrom: 'Made-up Buyer', description: 'Scrap cloth', amountCents: 100,
    }, expectedTotalCents: 100 }, idem());
    expect(posted.statusCode, posted.body).toBe(200);
    const id = posted.json().id as string;
    const cancelled = await accountant.post(`/api/docs/cash.other_receipt/${id}/cancel`, { reason: 'Recorded in wrong place' }, idem());
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect((await owner.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining({ kind: 'cancel' }));
    expect((await encoder.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'cancel' }));
    const second = await encoder.post('/api/docs/cash.other_receipt/post', { input: {
      cashPlaceId: cash, category: 'other_income', receivedFrom: 'Made-up Buyer', description: 'Spare fabric', amountCents: 200,
    }, expectedTotalCents: 200 }, idem());
    expect(second.statusCode, second.body).toBe(200);
    const reissued = await accountant.post(`/api/docs/cash.other_receipt/${second.json().id}/reissue`, { input: {
      cashPlaceId: cash, category: 'other_income', receivedFrom: 'Made-up Buyer', description: 'Fabric remnant', amountCents: 200,
    }, expectedTotalCents: 200, reason: 'Description needed correction' }, idem());
    expect(reissued.statusCode, reissued.body).toBe(200);
    env.db.prepare("UPDATE role_permissions SET granted = 1 WHERE role_key = 'accountant' AND permission_key = 'dash.changes.view'").run();
    expect((await accountant.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining({ kind: 'cancel' }));
    expect((await accountant.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining({ kind: 'reissue' }));
    env.db.prepare("UPDATE role_permissions SET granted = 0 WHERE role_key = 'owner' AND permission_key = 'dash.changes.view'").run();
    expect((await owner.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'cancel' }));
    expect((await owner.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'reissue' }));
    env.db.prepare("UPDATE role_permissions SET granted = 1 WHERE role_key = 'owner' AND permission_key = 'dash.changes.view'").run();
    env.db.prepare("UPDATE role_permissions SET granted = 0 WHERE role_key = 'owner' AND permission_key = 'cash.orc.view'").run();
    expect((await owner.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'cancel' }));
    env.db.close();
  });

  it('uses JO balance due for collectibles and a released order awaiting its invoice', async () => {
    const env = await createTestEnv();
    const encoder = await env.as('encoder');
    const accountant = await env.as('accountant');
    const customer = seedCustomers(env.db, encoder.userId).school;
    const jo = await jobOrder(env, customer);
    const cashPlaceId = (env.db.prepare("SELECT id FROM accounts WHERE code = '1101'").pluck().get()) as number;
    const collection = await encoder.post('/api/docs/col.collection/post', { input: {
      customerId: customer, crNumber: '991001', applications: [{ jobOrderId: jo, amountCents: 20_000 }],
      tenders: [{ cashPlaceId, amountCents: 20_000 }],
    }, expectedTotalCents: 20_000 }, idem());
    expect(collection.statusCode, collection.body).toBe(200);
    const collectibles = (await encoder.get('/api/dash/home')).json().widgets.find((w: { key: string }) => w.key === 'collectibles');
    expect(collectibles.items).toContainEqual(expect.objectContaining({ id: jo, amountCents: 80_000 }));
    for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) {
      expect((await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to })).statusCode).toBe(200);
    }
    const release = await accountant.post('/api/jo/releases', { release: {
      jobOrderId: jo, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Made-up Buyer', idSeen: 'school_id',
      creditNote: 'Balance will follow by bank transfer', creditDueInDays: 7,
    }, invoice: null, expectedTotalCents: 100_000 }, idem());
    expect(release.statusCode, release.body).toBe(200);
    expect((await encoder.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining({ kind: 'released-balance', amountCents: 80_000 }));
    env.clock.advance(16 * 86_400_000);
    const overdue = (await (await env.as('owner')).get('/api/dash/home')).json().widgets.find((w: { key: string }) => w.key === 'overdue-collectibles');
    expect(overdue.items).toContainEqual(expect.objectContaining({ id: jo, amountCents: 80_000 }));
    env.db.close();
  });

  it('counts only this month\'s collection journals', async () => {
    const env = await createTestEnv('2026-08-28T02:00:00Z');
    let encoder = await env.as('encoder');
    const customer = seedCustomers(env.db, encoder.userId).school;
    const jo = await jobOrder(env, customer);
    const cashPlaceId = (env.db.prepare("SELECT id FROM accounts WHERE code = '1101'").pluck().get()) as number;
    const collect = (crNumber: string, amountCents: number) => encoder.post('/api/docs/col.collection/post', { input: {
      customerId: customer, crNumber, applications: [{ jobOrderId: jo, amountCents }],
      tenders: [{ cashPlaceId, amountCents }],
    }, expectedTotalCents: amountCents }, idem());
    expect((await collect('991002', 10_000)).statusCode).toBe(200);
    env.clock.advance(31 * 86_400_000);
    encoder = await env.as('encoder');
    expect((await collect('991003', 20_000)).statusCode).toBe(200);
    const owner = await env.as('owner');
    const month = (await owner.get('/api/dash/home')).json().widgets.find((w: { key: string }) => w.key === 'collections');
    expect(month.amountCents).toBe(20_000);
    env.db.close();
  });

  it('ignores old closed orders without hiding notices for later open orders', async () => {
    const env = await createTestEnv();
    const encoder = await env.as('encoder');
    const customer = seedCustomers(env.db, encoder.userId).school;
    const first = await jobOrder(env, customer, 1);
    const firstDoc = env.db.prepare('SELECT number FROM documents WHERE id = ?').get(first) as { number: string };
    expect(firstDoc.number).toBe('JO-000001');
    const copyDoc = env.db.prepare(`INSERT INTO documents
      (id, doc_type, module, series_key, number, external_number, business_date, status, total_cents, summary, posted_at, posted_by)
      SELECT ?, doc_type, module, series_key, ?, external_number, business_date, status, total_cents, summary, posted_at, posted_by
      FROM documents WHERE id = ?`);
    const copyOrder = env.db.prepare(`INSERT INTO jo_orders
      (document_id, customer_id, customer_name, contact, due_date, priority, payment_terms, required_dp_cents, notes)
      SELECT ?, customer_id, customer_name, contact, ?, priority, payment_terms, required_dp_cents, notes
      FROM jo_orders WHERE document_id = ?`);
    const closeOrder = env.db.prepare(`INSERT INTO jo_stage_events (document_id, seq, from_stage, to_stage, at, user_id)
      VALUES (?, 1, 'open', 'closed', ?, ?)`);
    const dueDate = env.db.prepare('SELECT due_date FROM jo_orders WHERE document_id = ?').pluck().get(first) as string;
    let oldClosedId = '';
    for (let n = 2; n <= 202; n++) {
      const id = newId();
      copyDoc.run(id, `JO-${String(n).padStart(6, '0')}`, first);
      const closed = n <= 101;
      copyOrder.run(id, closed ? '2026-01-01' : dueDate, first);
      if (closed) closeOrder.run(id, stamp(env.clock), encoder.userId);
      if (n === 2) oldClosedId = id;
    }
    const notices = (await encoder.get('/api/dash/notifications')).json() as { kind: string; id: string }[];
    expect(notices.filter((n) => n.kind === 'jo-due')).toHaveLength(102);
    expect(notices.some((n) => n.id.startsWith('jo-overdue:'))).toBe(false);
    const collectibles = (await encoder.get('/api/dash/home')).json().widgets.find((w: { key: string }) => w.key === 'collectibles');
    expect(collectibles.items).not.toContainEqual(expect.objectContaining({ id: oldClosedId }));
    env.db.close();
  });
});
