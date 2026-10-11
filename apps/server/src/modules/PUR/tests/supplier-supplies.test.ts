/** Supplies linked to a supplier, and liter as a unit (the owner's request, Oct 2026). Made-up suppliers only. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let accountant: Client;
beforeEach(async () => { env = await createTestEnv(); accountant = await env.as('accountant'); });
afterEach(async () => { await env.app.close(); env.db.close(); });

it('takes liter as a unit, links supplies to a supplier (and unlinks them), and lists them both ways', async () => {
  const tela = (await accountant.post('/api/pur/suppliers', { name: 'Tela Trading', registeredName: 'Tela Trading Inc.', isVatRegistered: false })).json().id as string;
  const ink = await accountant.post('/api/pur/supplies', { name: 'Sublimation ink', unit: 'liter', category: 'materials' });
  expect(ink.statusCode, ink.body).toBe(200);
  const inkId = ink.json().id as string;
  const cotton = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id as string;

  for (const id of [inkId, cotton]) expect((await accountant.post(`/api/pur/suppliers/${tela}/supplies`, { supplyId: id, linked: true })).statusCode).toBe(200);
  const linked = (await accountant.get(`/api/pur/suppliers/${tela}/supplies`)).json() as { id: string; name: string; unit: string }[];
  expect(linked.map((s) => [s.name, s.unit])).toEqual([['Cotton twill', 'yard'], ['Sublimation ink', 'liter']]);
  expect((await accountant.get(`/api/pur/supplies/${inkId}/suppliers`)).json()).toEqual([{ id: tela, name: 'Tela Trading' }]);

  // Unlinked: off the list; the link row stays (master data is never deleted).
  expect((await accountant.post(`/api/pur/suppliers/${tela}/supplies`, { supplyId: cotton, linked: false })).statusCode).toBe(200);
  expect(((await accountant.get(`/api/pur/suppliers/${tela}/supplies`)).json() as { id: string }[]).map((s) => s.id)).toEqual([inkId]);
  expect(env.db.prepare('SELECT COUNT(*) FROM pur_supplier_supplies').pluck().get()).toBe(2);
  expect((await accountant.post(`/api/pur/suppliers/${tela}/supplies`, { supplyId: 'nope', linked: true })).statusCode).toBe(404);

  // A purchase order in liters records as any other.
  const input = { supplierId: tela, lines: [{ supplyId: inkId, qty: 5, unitCostCents: 85_000 }] };
  const p = await accountant.post('/api/docs/pur.po/preview', { input });
  const po = await accountant.post('/api/docs/pur.po/post', { input, expectedTotalCents: p.json().totalCents }, idem());
  expect(po.statusCode, po.body).toBe(200);
});
