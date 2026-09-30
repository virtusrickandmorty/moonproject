/**
 * The bank reconciliation list (GET /api/cash/recons) says who started and who finished each one, for the reconciliation screen.
 */
import { describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, createUser, login, PASSWORD } from '../../../../test/helpers.ts';

describe('GET /api/cash/recons: who did each reconciliation', () => {
  it('names the user who started it and the user who finished it, and hides the list from encoders', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'Ana', ['accountant']);
    createUser(env.db, 'Ben', ['owner']);
    const ana = await login(env.app, 'Ana', PASSWORD);
    const ben = await login(env.app, 'Ben', PASSWORD);
    const encoder = await env.as('encoder');
    const BDO = cashPlaceId(env.db, '1111');
    const CBC = cashPlaceId(env.db, '1112');

    const created = await ana.post('/api/cash/recons', { bankId: BDO, month: '2026-09', endingBalanceCents: 0 });
    expect(created.statusCode, created.body).toBe(200);
    const open = (await ben.get('/api/cash/recons')).json();
    expect(open).toEqual([expect.objectContaining({ id: created.json().id, bankId: BDO, month: '2026-09', status: 'open', bankBalanceCents: 0, createdByName: 'Ana', finishedAt: null, finishedByName: null })]);
    expect(open[0].createdAt).toMatch(/^2026-09-28T/);

    expect((await ben.post(`/api/cash/recons/${created.json().id}/finish`)).statusCode).toBe(200);
    await ana.post('/api/cash/recons', { bankId: CBC, month: '2026-09', endingBalanceCents: 0 });
    const rows = (await ana.get('/api/cash/recons')).json() as { bankId: number; status: string; createdByName: string; finishedByName: string | null; finishedAt: string | null }[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.bankId === BDO)).toMatchObject({ status: 'finished', createdByName: 'Ana', finishedByName: 'Ben' });
    expect(rows.find((r) => r.bankId === BDO)!.finishedAt).toMatch(/^2026-09-28T/);
    expect(rows.find((r) => r.bankId === CBC)).toMatchObject({ status: 'open', createdByName: 'Ana', finishedByName: null });

    expect((await encoder.get('/api/cash/recons')).statusCode).toBe(403);
  });
});
