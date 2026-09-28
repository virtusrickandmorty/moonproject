/** The opening fixed-asset form's rules, and what it builds recorded by the real server on the cut-over date. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key } from '../../api.ts';
import { FORMS } from '../screens.ts';
import { emptyOpening, openingInput, openingValues, type OpeningValues } from './opening.ts';

const press: OpeningValues = {
  ...emptyOpening(), classCode: 'machinery', description: ' Heat press ', location: 'Production floor', acquiredOn: '2025-10-15', cost: '100,000', residual: '10,000', life: '60', accumulated: '18,000',
};

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('opening fixed-asset form', () => {
  it('turns the values into input; blanks are no residual and no accumulated depreciation, and the usual life', () => {
    expect(openingInput(press, '2026-09-27')).toEqual({
      input: { classCode: 'machinery', description: 'Heat press', location: 'Production floor', acquiredOn: '2025-10-15', costCents: 10_000_000, residualCents: 1_000_000, lifeMonths: 60, accumulatedCents: 1_800_000 },
      errors: [],
    });
    expect(openingInput({ ...press, location: '', residual: '', life: '', accumulated: '' }).input).toEqual({
      classCode: 'machinery', description: 'Heat press', acquiredOn: '2025-10-15', costCents: 10_000_000, residualCents: 0, accumulatedCents: 0,
    });
  });

  it('names every typing slip', () => {
    expect(openingInput({ ...emptyOpening(), description: 'PC', acquiredOn: '15/10/2025', residual: '-1', life: '0', accumulated: 'x' }).errors).toEqual([
      'Pick the kind of asset.',
      'Describe the asset (3 letters or more).',
      'Type the date it was acquired like 2024-03-15.',
      'Type what it cost like 85,000.00',
      'Type the residual value like 5,000.00, or leave it blank for none.',
      'Type the useful life in months (1 to 600), or leave it empty for the usual life.',
      'Type the accumulated depreciation on the cut-over date like 12,500.00, or leave it blank for none.',
    ]);
    expect(openingInput({ ...press, acquiredOn: '2026-09-28', accumulated: '90,000.01' }, '2026-09-27').errors).toEqual([
      'It was acquired after the cut-over date, 2026-09-27. Record it as a fixed-asset purchase instead.',
      'The accumulated depreciation cannot be more than the cost less the residual value, ₱90,000.00.',
    ]);
  });

  it('prefills an edit from the stored input', () => {
    const stored = openingInput(press).input as Parameters<typeof openingValues>[0];
    expect(openingInput(openingValues(stored)).input).toEqual(stored);
  });

  it('is the fa.opening form, and the server records what it builds on the cut-over date', async () => {
    expect(FORMS['fa.opening']).toBeDefined();
    const env = await createTestEnv(); // today is 2026-09-28
    createUser(env.db, 'acct1', ['accountant']);
    const api = createApi(injectFetch(env.app));
    await api.login('acct1', PASSWORD);
    expect(await api.openingStatus()).toMatchObject({ cutoverDate: null, closed: null });
    const acc = await env.as('accountant');
    await acc.post('/api/auth/step-up', { password: PASSWORD });
    await acc.post('/api/acc/opening/cutover-date', { date: '2026-09-27' });
    const { cutoverDate } = await api.openingStatus();
    expect(cutoverDate).toBe('2026-09-27');

    const { input, errors } = openingInput(press, cutoverDate!);
    expect(errors).toEqual([]);
    const p = await api.preview('fa.opening', input, cutoverDate!);
    expect(p.issues).toEqual([]);
    expect(p.doc).toMatchObject({ bookValueCents: 8_200_000, monthsInService: 12, straightLineCents: 1_800_000, monthsLeft: 48, monthlyChargeCents: 150_000 });
    const posted = await api.post('fa.opening', input, p.totalCents, key(), cutoverDate!);
    expect(posted).toMatchObject({ number: 'OBFA-000001', businessDate: '2026-09-27', totalCents: 10_000_000 });
    expect((await api.get('fa.opening', posted.id)).input).toEqual(input);
    expect(await api.assets()).toMatchObject([{ id: posted.id, number: 'OBFA-000001', status: 'in service' }]);
  });
});
