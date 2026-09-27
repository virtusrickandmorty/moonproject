import { describe, expect, it } from 'vitest';
import { newId } from '@moonproject/shared';
import { createTestEnv, idem } from '../../../../test/helpers.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { postJournal } from '../../../engine/ledger/post.ts';

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
    expect(old).toMatchObject({ read: false });
    expect((await owner.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ id: old!.id }));
    expect((await encoder.post('/api/dash/notifications/read', { id: old!.id })).statusCode).toBe(200);
    expect((await encoder.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining({ id: old!.id, read: true }));
    env.db.prepare("UPDATE role_permissions SET granted = 0 WHERE role_key = 'encoder' AND permission_key = 'quo.create'").run();
    expect((await encoder.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ id: old!.id }));
    expect((await encoder.post('/api/dash/notifications/read', { id: old!.id })).statusCode).toBe(404);
    env.db.close();
  });

  it('shows cancellations only to an owner who may view the document', async () => {
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
    env.db.prepare("UPDATE role_permissions SET granted = 0 WHERE role_key = 'owner' AND permission_key = 'cash.orc.view'").run();
    expect((await owner.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'cancel' }));
    env.db.close();
  });
});
