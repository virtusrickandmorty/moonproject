import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { PAGES } from '../screens.ts';
import { FiledReturns } from './FiledReturns.tsx';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('Filed returns screen', () => {
  it('appears in Accounting & Tax only with the viewing permission', () => {
    expect(PAGES['/tax/filed-returns']).toBe(FiledReturns);
    const item = { group: 'Accounting & Tax', label: 'Filed returns', path: '/tax/filed-returns', permission: 'tax.registers.view' };
    expect(buildMenu([], new Set(['tax.registers.view'])).find((g) => g.group === 'Accounting & Tax')!.items).toContainEqual(item);
    expect(buildMenu([], new Set()).flatMap((g) => g.items)).not.toContainEqual(item);
  });

  it('loads the server day and forms, records with step-up and retains the voided row through the web client', async () => {
    const env = await createTestEnv();
    try {
      createUser(env.db, 'sample-accountant', ['accountant']);
      const web = createApi(injectFetch(env.app));
      await web.login('sample-accountant', PASSWORD);
      const initial = await web.filedReturns();
      expect(initial).toEqual({ today: '2026-09-28', forms: ['2550Q', '0619-E', '1601-EQ', '1702Q', '1702', '1601-FQ', '1601-C'], rows: [] });
      const body = { form: '1601-C', period: '2026-07', filedOn: '2026-08-10', reference: 'eFPS confirmation 0001' };
      await expect(web.addFiledReturn(body)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
      await web.stepUp(PASSWORD);
      const row = await web.addFiledReturn(body);
      expect(row).toMatchObject({ ...body, voidedAt: null });
      expect((await web.filedReturns()).rows).toEqual([row]);
      await web.voidFiledReturn(row.id, 'Wrong period on the confirmation');
      expect((await web.filedReturns()).rows).toEqual([expect.objectContaining({ ...body, id: row.id, voidReason: 'Wrong period on the confirmation', voidedAt: expect.any(String) })]);
    } finally { await env.app.close(); env.db.close(); }
  });
});
