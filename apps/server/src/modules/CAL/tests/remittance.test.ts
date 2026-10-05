import { describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, PASSWORD } from '../../../../test/helpers.ts';
import { addEmployee } from '../../EMP/tests/fixture.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import type { CalItem } from '../calendar.ts';

describe('calendar government remittances', () => {
  it('shows pending schemes on their due date, hides a paid scheme, and requires stat.view', async () => {
    const env = await createTestEnv('2026-10-05T02:00:00Z');
    try {
      const accountant = await env.as('accountant');
      const production = await env.as('production');
      const employeeId = addEmployee(env.db, 'Mira Made-up');
      expect((await accountant.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
      expect((await accountant.post('/api/acc/opening/cutover-date', { date: '2026-10-01' })).statusCode).toBe(200);
      for (const month of ['2026-08', '2026-09']) {
        const opened = await accountant.post('/api/docs/stat.opening/post', { input: {
          month, employees: [{ employeeId, sssCents: 100, phicCents: 100, hdmfCents: 100, wtaxCents: 100 }],
        }, businessDate: '2026-10-01', expectedTotalCents: 400 }, idem());
        expect(opened.statusCode, opened.body).toBe(200);
      }
      const rows = async (from = '2026-10-01', to = '2026-10-31', client = accountant) => {
        const res = await client.get(`/api/cal?from=${from}&to=${to}`);
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as CalItem[]).filter((i) => i.kind === 'remittance');
      };
      const pending = (scheme: string, label: string) => ({ id: `remittance:${scheme}:2026-09`, date: '2026-10-31', kind: 'remittance', title: `${label} for September 2026 due`, href: '/stat' });
      expect(await rows()).toEqual([pending('HDMF', 'Pag-IBIG'), pending('PHIC', 'PhilHealth'), pending('SSS', 'SSS')]);
      expect(await rows('2026-10-01', '2026-10-30')).toEqual([]);
      expect(await rows('2026-10-31', '2026-10-31')).toHaveLength(3);
      expect(await rows('2026-09-30', '2026-10-31')).toHaveLength(6);
      expect(await rows('2026-11-01', '2026-11-30')).toEqual([]); // no payroll or opening balance for October
      expect(await rows('2026-10-01', '2026-10-31', production)).toEqual([]);
      env.db.prepare('UPDATE role_permissions SET granted = 0 WHERE role_key = ? AND permission_key = ?').run('accountant', 'stat.view');
      expect(await rows()).toEqual([]);
      env.db.prepare('UPDATE role_permissions SET granted = 1 WHERE role_key = ? AND permission_key = ?').run('accountant', 'stat.view');
      const paid = await accountant.post('/api/docs/stat.remittance/post', { input: {
        scheme: 'SSS', month: '2026-09', cashPlaceId: cashPlaceId(env.db, '1111'), amountCents: 100, reference: 'MADE-UP-SSS-001',
      }, expectedTotalCents: 100 }, idem());
      expect(paid.statusCode, paid.body).toBe(200);
      expect(await rows()).toEqual([pending('HDMF', 'Pag-IBIG'), pending('PHIC', 'PhilHealth')]);
      const cancelled = await accountant.post(`/api/docs/stat.remittance/${paid.json().id}/cancel`, { reason: 'Wrong remittance reference recorded' }, idem());
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect(await rows()).toContainEqual(pending('SSS', 'SSS'));
      expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
    } finally { await env.app.close(); env.db.close(); }
  });
});
