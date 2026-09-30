import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey, type SheetSupply } from '../../api.ts';
import { FORMS, VIEWS } from '../screens.ts';
import { buildMenu } from '../../shell/menu.ts';
import { costChanged, countLines, countSheetCsvUrl, defaultCountDate, formatQty, lineValue, parseQty } from './count.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

const twill: SheetSupply = { supplyId: 't', name: 'Cotton twill', unit: 'yard', milliUnits: true, defaultCostCents: 12_000, costSource: 'catalogue', costSourceNumber: null };
const cone: SheetSupply = { supplyId: 'c', name: 'Thread cone', unit: 'pc', milliUnits: false, defaultCostCents: 5_000, costSource: 'po', costSourceNumber: 'PO-000001' };

describe('INV count screen rules', () => {
  it('has its own form and view, and sits under Purchases & Expenses', () => {
    expect(FORMS['inv.count']).toBeDefined();
    expect(VIEWS['inv.count']).toBeDefined();
    const menu = buildMenu([{ key: 'inv.count', module: 'INV', title: 'Inventory Count' }] as never[], new Set());
    expect(menu.find((g) => g.group === 'Purchases & Expenses')!.items.map((i) => i.label)).toEqual(['Inventory Counts']);
  });

  it('reads yards, meters and kilos to three decimals as milli-units, pieces whole', () => {
    expect(parseQty('12.5', true)).toBe(12_500);
    expect(parseQty('1,234.567', true)).toBe(1_234_567);
    expect(parseQty('12.3456', true)).toBeUndefined();
    expect(parseQty('12.5', false)).toBeUndefined();
    expect(parseQty('-3', false)).toBeUndefined();
    expect(parseQty('0', false)).toBe(0);
    expect(formatQty(12_500, true)).toBe('12.5');
    expect(formatQty(12_000, true)).toBe('12');
    expect(formatQty(12_345, true)).toBe('12.345');
    expect(formatQty(12, false)).toBe('12');
    expect(lineValue(12_345, 12_345, true)).toBe(152_399); // rounded per line, as the server
  });

  it('builds the lines to send, the live total and what to fix', () => {
    expect(countLines([twill, cone], { t: { qty: '200', cost: '', reason: '' }, c: { qty: '20', cost: '50.00', reason: '' } })).toEqual({
      lines: [{ supplyId: 't', qty: 200_000 }, { supplyId: 'c', qty: 20 }], totalCents: 2_500_000, errors: [],
    });
    const changed = { t: { qty: '12.345', cost: '123.45', reason: '' } };
    expect(costChanged(changed.t, twill)).toBe(true);
    expect(countLines([twill], changed).errors).toEqual(['Cotton twill: say why the cost is not the latest purchase cost.']);
    expect(countLines([twill], { t: { ...changed.t, reason: 'Price went up' } }).lines).toEqual([{ supplyId: 't', qty: 12_345, unitCostCents: 12_345, costReason: 'Price went up' }]);
    expect(countLines([twill, cone], { t: { qty: 'lots', cost: '', reason: '' }, c: { qty: '2', cost: 'free', reason: '' } }).errors).toEqual([
      'Cotton twill: type the quantity in yard like 12.5.',
      'Thread cone: type the cost per pc like 120.00, or leave it empty for 50.00.',
    ]);
    expect(countLines([twill], {}).lines).toEqual([]); // nothing typed: nothing on hand
  });

  it('offers today on a month end, else the last month end', () => {
    expect(defaultCountDate('2026-09-30')).toBe('2026-09-30');
    expect(defaultCountDate('2026-10-02')).toBe('2026-09-30');
    expect(defaultCountDate('2026-03-15')).toBe('2026-02-28');
    expect(defaultCountDate('2026-01-05')).toBe('2025-12-31');
    expect(countSheetCsvUrl('ready_made', '2026-09-30')).toBe('/api/inv/count-sheet?category=ready_made&date=2026-09-30');
  });
});

describe('INV web client against server routes', () => {
  it('loads the sheet, previews the adjustment on a backdated month end, and records the count', async () => {
    const env = await createTestEnv('2026-10-02T02:00:00Z');
    createUser(env.db, 'acct1', ['accountant']);
    createUser(env.db, 'enc1', ['encoder']);
    const accountant = createApi(injectFetch(env.app));
    const encoder = createApi(injectFetch(env.app));
    await accountant.login('acct1', PASSWORD);
    await encoder.login('enc1', PASSWORD);
    env.db.prepare(`INSERT INTO pur_supplies (id, name, unit, category, last_purchase_cost_cents, created_at, updated_at) VALUES ('s1', 'Cotton twill', 'yard', 'materials', 12000, '2026-09-01T10:00:00+08:00', '2026-09-01T10:00:00+08:00')`).run();

    const sheet = await encoder.countSheet('materials', '2026-09-30');
    expect(sheet.supplies).toEqual([{ supplyId: 's1', name: 'Cotton twill', unit: 'yard', milliUnits: true, defaultCostCents: 12_000, costSource: 'catalogue', costSourceNumber: null }]);
    const { lines, totalCents } = countLines(sheet.supplies, { s1: { qty: '10.5', cost: '', reason: '' } });
    const input = { category: 'materials', lines };

    const today = await encoder.preview('inv.count', input);
    expect(today.issues.map((i) => i.code)).toEqual(['NOT_MONTH_END']);
    await expect(encoder.preview('inv.count', input, '2026-09-30')).rejects.toMatchObject({ status: 403 });
    const p = await accountant.preview('inv.count', input, '2026-09-30');
    expect(p).toMatchObject({ totalCents, issues: [], doc: { countedCents: 126_000, ledgerCents: 0, adjustmentCents: 126_000 } });
    expect(p.journal?.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([['1301', 126_000, 0], ['5109', 0, 126_000]]);
    const r = await accountant.post('inv.count', input, p.totalCents, newIdempotencyKey(), '2026-09-30');
    expect(r).toMatchObject({ number: 'INVC-000001', businessDate: '2026-09-30' });
  });
});
