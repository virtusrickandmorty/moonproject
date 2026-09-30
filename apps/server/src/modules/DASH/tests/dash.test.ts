import { describe, expect, it } from 'vitest';
import { newId } from '@moonproject/shared';
import { createTestEnv, idem } from '../../../../test/helpers.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { postJournal } from '../../../engine/ledger/post.ts';
import { appendAudit } from '../../../engine/audit.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { ownerHealth } from '../health.ts';
import { arAging, apAging, cashPosition, collectionsRegister, depositsHeld, payrollRegister, productionTiming } from '../../RPT/public.ts';
import { salesRegister, taxDeadlines, vatSummary } from '../../TAX/public.ts';

const addDays = (date: string, days: number) => {
  const value = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
};

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
    expect(homes[1]!.widgets.map((w) => w.key)).toEqual(['drafts', 'exceptions', 'vat-quarter', 'month-end', 'integrity']);
    expect(homes[2]!.widgets.map((w) => w.key)).toEqual(['vat-quarter', 'month-end', 'integrity', 'overdue-collectibles', 'cash', 'sales', 'collections', 'cancellations']);
    expect(homes[3]!.widgets.map((w) => w.key)).toEqual(['production']);
    expect((await owner.get('/api/dash/owner-health')).statusCode).toBe(200);
    for (const client of [encoder, accountant, production]) expect((await client.get('/api/dash/owner-health')).statusCode).toBe(403);
    env.db.close();
  });

  it('uses the VAT worksheet, month-end checklist and AUD results for accounting widgets', async () => {
    const env = await createTestEnv();
    const accountant = await env.as('accountant');
    const home = (await accountant.get('/api/dash/home')).json();
    const vat = vatSummary(env.db, 2026, 3);
    expect(home.widgets.find((w: { key: string }) => w.key === 'vat-quarter').items).toEqual([
      { id: 'output', label: 'Output VAT', amountCents: vat.outputVatCents },
      { id: 'input', label: 'Input VAT', amountCents: vat.inputVatCents },
      { id: 'payable', label: 'VAT payable so far', amountCents: vat.payableCents },
    ]);
    const checklist = (await accountant.get('/api/acc/month-end?month=2026-08')).json();
    const done = checklist.items.filter((item) => item.state === 'done').length;
    expect(home.widgets.find((w: { key: string }) => w.key === 'month-end').items[0].label).toBe(`${done} of ${checklist.items.length} steps done`);

    env.db.prepare("INSERT INTO aud_nightly_runs (id, night, covers_from, ran_at, found_count) VALUES ('dash-run', '2026-09-27', '2026-09-27', '2026-09-28T02:00:00.000+08:00', 1)").run();
    env.db.prepare("INSERT INTO aud_nightly_checks (run_id, check_key, passed, found_count) VALUES ('dash-run', 'integrity', 0, 1)").run();
    const failed = (await accountant.get('/api/dash/home')).json().widgets.find((w: { key: string }) => w.key === 'integrity');
    expect(failed).toMatchObject({ tone: 'danger', items: [
      { label: 'Last nightly check', detail: expect.stringContaining('1 found') },
      { label: 'Last integrity check', detail: expect.stringContaining('1 found') },
    ] });

    for (const permission of ['tax.registers.view', 'acc.monthend.view', 'aud.integrity.view']) {
      env.db.prepare("UPDATE role_permissions SET granted = 0 WHERE role_key = 'accountant' AND permission_key = ?").run(permission);
    }
    const hidden = (await (await env.as('accountant')).get('/api/dash/home')).json();
    expect(hidden.widgets.map((w: { key: string }) => w.key)).not.toEqual(expect.arrayContaining(['vat-quarter', 'month-end', 'integrity']));
    expect((await (await env.as('encoder')).get('/api/dash/home')).json().widgets.map((w: { key: string }) => w.key)).not.toEqual(expect.arrayContaining(['vat-quarter', 'month-end', 'integrity']));
    env.db.close();
  });

  it('builds every owner health figure from its report calculation', async () => {
    const env = await createTestEnv();
    const owner = await env.as('owner');
    const customerId = seedCustomers(env.db, owner.userId).school;
    await jobOrder(env, customerId, 2);
    const place = (await owner.post('/api/cash/places', { name: 'Sample cash box', kind: 'cash', encoderSeesBalance: true })).json() as { id: number };
    tx(env.db, () => postJournal(env.db, { memo: 'Made-up cash balance', lines: [
      { account: { cashPlace: place.id }, debitCents: 12_345 },
      { account: { role: 'CASH_SHORT_OVER' }, creditCents: 12_345 },
    ] }, { sourceType: 'test', sourceId: newId(), businessDate: today(env.clock), userId: owner.userId, at: stamp(env.clock) }));

    const date = today(env.clock);
    const result = ownerHealth(env.db, date);
    for (const period of result.periods) {
      const sales = salesRegister(env.db, period.from, period.to);
      expect(period).toMatchObject({
        salesCents: sales.totals.netCents,
        vatCents: sales.totals.vatCents,
        collectionsCents: collectionsRegister(env.db, period.from, period.to).tenderCents,
        payrollCents: payrollRegister(env.db, period.from.slice(0, 7)).totals.grossCents,
      });
    }
    expect(result.cashPlaces).toEqual(cashPosition(env.db, date).rows);
    const ar = arAging(env.db, date);
    expect(result.receivables).toEqual({ totalCents: ar.totalCents,
      over30Cents: ar.buckets.days31to60 + ar.buckets.days61to90 + ar.buckets.over90,
      over60Cents: ar.buckets.days61to90 + ar.buckets.over90, over90Cents: ar.buckets.over90 });
    const ap = apAging(env.db, date);
    expect(result.payables).toEqual({ totalCents: ap.totalCents, dueNext7DaysCents: ap.rows
      .filter((row) => row.dueDate >= date && row.dueDate <= addDays(date, 7)).reduce((sum, row) => sum + row.balanceCents, 0) });
    const jobs = productionTiming(env.db, date);
    const weekEnd = addDays(date, 7 - (new Date(`${date}T00:00:00Z`).getUTCDay() || 7));
    const openJobs = jobs.rows.filter((row) => row.releaseDate === null);
    expect(result.jobs).toEqual({ open: openJobs.length,
      dueThisWeek: openJobs.filter((row) => String(row.dueDate) >= date && String(row.dueDate) <= weekEnd).length,
      late: jobs.late.length });
    expect(result.depositsHeldCents).toBe(depositsHeld(env.db, date).totalCents);
    expect(result.taxDeadlines).toEqual(taxDeadlines(env.db, date, addDays(date, 120)).slice(0, 6));
    expect((await owner.get('/api/dash/owner-health')).json()).toEqual(result);
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
    expect((await encoder.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining({ kind: 'invoice-to-follow', id: `invoice-to-follow:${release.json().release.id}` }));
    expect((await (await env.as('production')).get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'invoice-to-follow' }));
    const invoice = await encoder.post('/api/docs/jo.invoice_record/post', { input: { releaseId: release.json().release.id, invoiceNumber: '9911' }, expectedTotalCents: 100_000 }, idem());
    expect(invoice.statusCode, invoice.body).toBe(200);
    expect((await encoder.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'invoice-to-follow' }));
    env.clock.advance(16 * 86_400_000);
    const overdue = (await (await env.as('owner')).get('/api/dash/home')).json().widgets.find((w: { key: string }) => w.key === 'overdue-collectibles');
    expect(overdue.items).toContainEqual(expect.objectContaining({ id: jo, amountCents: 80_000 }));
    env.db.close();
  });

  it('sends guarded-action notices only to owners for 14 days', async () => {
    const env = await createTestEnv();
    const [owner, accountant, encoder, production] = await Promise.all([env.as('owner'), env.as('accountant'), env.as('encoder'), env.as('production')]);
    appendAudit(env.db, { at: stamp(env.clock), userId: accountant.userId, action: 'acc.setting.add', entityType: 'setting', entityId: 'col.cr_mode' });
    const ownerNotices = (await owner.get('/api/dash/notifications')).json();
    expect(ownerNotices).toContainEqual(expect.objectContaining({ kind: 'step-up-action', label: expect.stringContaining('changed a setting'), detail: expect.stringContaining('col.cr_mode'), href: '/aud/log' }));
    for (const client of [accountant, encoder, production]) expect((await client.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'step-up-action' }));
    env.clock.advance(15 * 86_400_000);
    expect((await owner.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'step-up-action' }));
    env.db.close();
  });

  it('shows overdue sizer loans only to encoder and production until returned', async () => {
    const env = await createTestEnv();
    const [encoder, production, accountant] = await Promise.all([env.as('encoder'), env.as('production'), env.as('accountant')]);
    const customer = seedCustomers(env.db, encoder.userId).school;
    const setId = newId();
    const loanId = newId();
    const at = stamp(env.clock);
    env.db.prepare("INSERT INTO szr_sets (id, code, garment_type, sizes_included, status, created_at, updated_at) VALUES (?, 'SZ-MADE-UP', 'Shirt', 'S,M,L', 'lent', ?, ?)").run(setId, at, at);
    env.db.prepare(`INSERT INTO szr_loans (id, set_id, customer_id, date_out, expected_return_date, created_at, updated_at)
      VALUES (?, ?, ?, '2026-09-01', '2026-09-20', ?, ?)`).run(loanId, setId, customer, at, at);
    for (const client of [encoder, production]) expect((await client.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining({ kind: 'sizer-overdue', id: `sizer-overdue:${loanId}`, href: '/szr/sets' }));
    expect((await accountant.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'sizer-overdue' }));
    env.db.prepare("UPDATE szr_loans SET returned_date = '2026-09-28', condition_on_return = 'complete' WHERE id = ?").run(loanId);
    expect((await encoder.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'sizer-overdue' }));
    env.db.close();
  });

  it('shows a pending 2307 after 30 days until it is received', async () => {
    const env = await createTestEnv();
    const encoder = await env.as('encoder');
    const customer = seedCustomers(env.db, encoder.userId).school;
    const jo = await jobOrder(env, customer);
    const cashPlaceId = env.db.prepare("SELECT id FROM accounts WHERE code = '1101'").pluck().get() as number;
    const collection = await encoder.post('/api/docs/col.collection/post', { input: {
      customerId: customer, crNumber: '991007', applications: [{ jobOrderId: jo, amountCents: 100_000 }],
      tenders: [{ cashPlaceId, amountCents: 99_000 }], withholding: { cwtCents: 1_000, atc: 'WC158', certificate: 'pending' },
    }, expectedTotalCents: 100_000 }, idem());
    expect(collection.statusCode, collection.body).toBe(200);
    env.clock.advance(31 * 86_400_000);
    const [laterEncoder, laterAccountant] = await Promise.all([env.as('encoder'), env.as('accountant')]);
    for (const client of [laterEncoder, laterAccountant]) expect((await client.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining({ kind: '2307-to-chase', id: `2307-to-chase:${collection.json().id}` }));
    expect((await (await env.as('production')).get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: '2307-to-chase' }));
    expect((await laterAccountant.post('/api/tax/2307s/received', { documentId: collection.json().id, lineNo: 0 })).statusCode).toBe(200);
    expect((await laterEncoder.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: '2307-to-chase' }));
    env.db.close();
  });

  it('shows unpaid tax deadlines in the next seven days only to permitted accounting roles', async () => {
    const env = await createTestEnv('2026-09-05T02:00:00Z');
    const accountant = await env.as('accountant');
    const encoder = await env.as('encoder');
    const notice = { kind: 'tax-deadline', id: 'tax-deadline:0619-E:2026-08', href: '/tax/calendar' };
    expect((await accountant.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining(notice));
    expect((await encoder.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'tax-deadline' }));
    const id = newId();
    const at = stamp(env.clock);
    env.db.prepare(`INSERT INTO documents (id, doc_type, module, series_key, number, business_date, status, total_cents, summary, posted_at, posted_by)
      VALUES (?, 'tax.bir_payment', 'TAX', 'BIRP', 'BIRP-MADE-UP', '2026-09-05', 'posted', 100, 'Made-up paid return', ?, ?)`)
      .run(id, at, accountant.userId);
    const cash = env.db.prepare("SELECT id FROM accounts WHERE code = '1101'").pluck().get() as number;
    env.db.prepare(`INSERT INTO tax_bir_payments (document_id, form, period, cash_account_id, reference, payable_cents, amount_cents, penalty_cents)
      VALUES (?, '0619-E', '2026-08', ?, 'MADE-UP-REF', 100, 100, 0)`).run(id, cash);
    expect((await accountant.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining(notice));
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
