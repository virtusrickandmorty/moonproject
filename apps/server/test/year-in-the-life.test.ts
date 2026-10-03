/**
 * A year in the life (K51): the shop of tools/year-scenario.ts switches over on 1 October 2026 through the
 * opening balances wizard and works to 31 December 2027 through the same routes as the screens: sales in deposit VAT
 * modes A, B and C, collections with CWT and a government buyer's VAT withheld, a credit memo, a write-off, supplier
 * bills with EWT and their payments, expense vouchers, payroll twice a month for five employees (monthly above and below
 * the tax line, a daily minimum wage earner, a piece worker, a daily and piece worker), SSS and Pag-IBIG loans, cash
 * advances, remittances and BIR payments on their due dates, an asset bought and one sold, quarterly counts, SIL taken
 * and SIL paid in cash, the 13th month, the year-end tax adjustment, the 1702Q, the 1702-RT provision and settlement.
 *
 * Every expected figure is worked out by hand in tests/golden/year-workings.md, never by calling the app: the trial
 * balance at the cut-over and at each quarter end is tests/golden/year.tb.csv, and the returns and remittances (what is
 * typed on each, and the totals their worksheets must show, the 2316s included) are tests/golden/year.returns.csv. The
 * scenario types the amounts of year.returns.csv, so a worksheet that disagrees shows as a refused payment or a
 * different trial balance.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runInvariants } from '../src/engine/ledger/invariants.ts';
import { CUTOVER, EMPLOYEES, QUARTER_ENDS, SEWER, returnsGolden, runYear, type ReturnRow, type Year } from '../../../tools/year-scenario.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const pesos = (s: string) => Math.round(Number(s) * 100);

interface TbRow { code: string; name: string; debitCents: number; creditCents: number }
/** tests/golden/year.tb.csv, by date. */
function goldenTb(): Map<string, TbRow[]> {
  const [head, ...rows] = readFileSync(`${ROOT}tests/golden/year.tb.csv`, 'utf8').trim().split('\n');
  expect(head).toBe('as_of,account_code,account_name,debit,credit');
  const out = new Map<string, TbRow[]>();
  for (const r of rows) {
    const m = /^(\d{4}-\d\d-\d\d),(\d{4}),("(?:[^"]|"")*"|[^,]*),([\d.]+),([\d.]+)$/.exec(r);
    if (!m) throw new Error(`Cannot read the trial balance line: ${r}`);
    const row = { code: m[2]!, name: m[3]!.replace(/^"|"$/g, '').replace(/""/g, '"'), debitCents: pesos(m[4]!), creditCents: pesos(m[5]!) };
    out.set(m[1]!, [...(out.get(m[1]!) ?? []), row]);
  }
  return out;
}
const TB = goldenTb();
const RETURNS = returnsGolden();
const hand = (kind: string, period: string, item: string) => {
  const r = RETURNS.find((x) => x.kind === kind && x.period === period && x.item === item);
  if (!r) throw new Error(`year.returns.csv has no ${kind} ${period} ${item}`);
  return r.cents;
};
const of = (rows: ReturnRow[], kind: string) => rows.filter((r) => r.kind === kind);

let y: Year;
const get = <T = any>(url: string) => y.m.get<T>(url);
const tbOf = async (asOf: string): Promise<TbRow[]> =>
  (await get(`/api/rpt/trial-balance?asOf=${asOf}`)).rows.map((r: TbRow) => ({ code: r.code, name: r.name, debitCents: r.debitCents, creditCents: r.creditCents }));
/** Net income (4xxx to 8xxx, credit positive) of a golden trial balance, the way the balance sheet's virtual close counts it. */
const earnings = (rows: TbRow[]) => rows.filter((r) => r.code >= '4').reduce((s, r) => s + r.creditCents - r.debitCents, 0);

beforeAll(async () => {
  y = await runYear();
}, 300_000);

describe('year in the life: the hand-worked goldens', () => {
  it('every trial balance of year.tb.csv balances, and the opening leaves 3900 at zero', () => {
    expect([...TB.keys()]).toEqual([CUTOVER, ...QUARTER_ENDS]);
    for (const [asOf, rows] of TB) {
      const sum = (k: 'debitCents' | 'creditCents') => rows.reduce((s, r) => s + r[k], 0);
      expect(sum('debitCents'), asOf).toBe(sum('creditCents'));
    }
    expect(TB.get(CUTOVER)!.find((r) => r.code === '3900')).toBeUndefined();
    expect(TB.get(CUTOVER)!.reduce((s, r) => s + r.debitCents, 0)).toBe(159_700_000); // ₱1,597,000.00 each side
  });

  it('each 2316 of year.returns.csv adds up: its parts are its gross', () => {
    for (const year of ['2026', '2027']) {
      for (const name of EMPLOYEES) {
        const f = (item: string) => hand('2316', year, `${name}: ${item}`);
        expect(f('i29') + f('i34') + f('i35') + f('i36') + f('i52'), `${name} ${year}`).toBe(f('i19'));
        expect(f('i19'), `${name} ${year}`).toBe(f('gross'));
      }
    }
  });
});

describe('year in the life: the app against the goldens', () => {
  it('opens on the cut-over date through the wizard: the opening trial balance is the golden one and the opening is closed', async () => {
    expect(await tbOf(CUTOVER)).toEqual(TB.get(CUTOVER));
    expect((await get('/api/acc/opening')).closed).toMatchObject({ cutoverDate: CUTOVER, totalDebitCents: 159_700_000, totalCreditCents: 159_700_000 });
  });

  for (const asOf of QUARTER_ENDS) {
    it(`ends ${asOf} on the golden trial balance, to the centavo, account names included`, async () => {
      expect(await tbOf(asOf)).toEqual(TB.get(asOf));
    });
  }

  it('raises only the warnings the workings expect', () => {
    expect(y.warnings.map((w) => `${w.ref} ${w.code}`).sort()).toEqual([
      '2026 ITP BOOKS_START', // the 2026 books start on 1 October (workings §10)
      ...Array(2).fill('2027 TH13 office EARLIER_BASIC'), // the 13th month of 2027 counts the 16–31 December 2026 payroll (§6)
      ...Array(3).fill('2027 TH13 production EARLIER_BASIC'),
    ].sort());
  });

  it('pays every remittance and BIR return on the due date of the tax calendar, at the amount worked by hand', async () => {
    const calendar = await get<{ form: string; period: string; dueDate: string }[]>(`/api/tax/calendar?from=${CUTOVER}&to=2028-04-30`);
    const dueOf = (form: string, period: string) => calendar.find((c) => c.form === form && c.period === period)?.dueDate;
    const paid = y.m.recorded.filter((r) => r.type === 'stat.remittance' || r.type === 'tax.bir_payment');
    expect(paid.length).toBe(60 + 10 + 5 + 5 + 3 + 1); // Sep 2026 to Nov 2027 × 4 schemes; ten 0619-Es; 1601-EQ and 2550Q of Q3 2026 to Q3 2027; three 1702Qs; the 1702 of 2026
    for (const r of paid) {
      const d = (await get(`/api/docs/${r.type}/${r.id}`)).doc;
      const [form, period] = r.type === 'stat.remittance' ? ['1601-C', d.month] : [d.form === '1702' ? '1702-RT' : d.form, d.period];
      expect([r.ref, r.date], r.ref).toEqual([r.ref, dueOf(form, period)]);
      const kind = r.type === 'stat.remittance' ? `REM ${d.scheme}` : d.form;
      expect(d.amountCents, r.ref).toBe(hand(kind, r.type === 'stat.remittance' ? d.month : d.period, 'paid'));
    }
    // Everything the payrolls left payable through November 2027 is remitted; December 2027's is due in January 2028.
    for (const m of await get<{ month: string; check: { scheme: string; balanceCents: number }[] }[]>('/api/stat/months')) {
      for (const c of m.check) expect(c.balanceCents === 0, `${m.month} ${c.scheme}`).toBe(m.month < '2027-12');
    }
  });

  it('2550Q: each quarter’s worksheet shows the VATable sales, output VAT, input VAT, VAT withheld and payable worked by hand', async () => {
    for (const q of ['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4']) {
      const w = await get(`/api/tax/2550q?year=${q.slice(0, 4)}&quarter=${q.slice(6)}`);
      const line = (key: string) => w.lines.find((l: { key: string }) => l.key === key);
      expect([line('vatable_sales').amountCents, line('output_tax').taxCents, line('input_tax').taxCents, line('vat_withheld').taxCents, line('payable').taxCents], q).toEqual(
        ['VATable sales', 'output VAT', 'input VAT', 'VAT withheld', 'payable'].map((i) => hand('2550Q', q, i)),
      );
      expect(w.close?.number ?? null, q).toMatch(/^VATC-/);
    }
  });

  it('0619-E and 1601-EQ: each quarter withholds what the workings say; the quarter return pays its third month', async () => {
    for (const q of ['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4']) {
      const w = await get(`/api/tax/1601eq?year=${q.slice(0, 4)}&quarter=${q.slice(6)}`);
      expect(w.totals.ewtCents, q).toBe(hand('1601-EQ', q, 'EWT withheld'));
      // Q4 2027 is due in January 2028: what October and November's 0619-Es did not pay, December's EWT, is left.
      expect(w.leftCents, q).toBe(q === '2027-Q4' ? hand('1601-EQ', q, 'EWT withheld') - hand('0619-E', '2027-10', 'paid') - hand('0619-E', '2027-11', 'paid') : 0);
    }
    for (const m of of(RETURNS, '0619-E')) expect((await get(`/api/tax/0619e?month=${m.period}`)).leftCents, m.period).toBe(0);
  });

  it('1702Q: the cumulative quarters of 2027, the tax due and what each paid', async () => {
    for (const q of [1, 2, 3]) {
      const w = await get(`/api/tax/1702q?year=2027&quarter=${q}`);
      const line = (key: string) => w.lines.find((l: { key: string }) => l.key === key).cents;
      expect([line('taxable_income'), line('tax_due'), line('payable')], `Q${q}`).toEqual(['taxable income', 'tax due', 'paid'].map((i) => hand('1702Q', `2027-Q${q}`, i)));
      expect(w.leftCents, `Q${q}`).toBe(0);
    }
  });

  it('1702-RT: 2026 (the books from 1 October) provided, settled against its 2307s and paid; 2027 provided and settled, payable in April 2028', async () => {
    for (const year of [2026, 2027]) {
      const w = await get(`/api/tax/1702rt?year=${year}`);
      const line = (key: string) => w.lines.find((l: { key: string }) => l.key === key).cents;
      expect([line('taxable_income'), line('tax_due'), line('payable')], String(year)).toEqual(['taxable income', 'tax due', 'payable'].map((i) => hand('1702-RT', String(year), i)));
      expect([w.provision?.amountCents, w.settlement?.payableCents], String(year)).toEqual([hand('1702-RT', String(year), 'tax due'), hand('1702-RT', String(year), 'payable')]);
      expect(w.leftCents, String(year)).toBe(year === 2026 ? 0 : hand('1702-RT', '2027', 'payable'));
    }
    expect((await get('/api/tax/1702rt?year=2026')).checks.map((c: { code: string }) => c.code)).toEqual(['BOOKS_START']);
  });

  it('2316: each employee’s figures for 2026 (with the pay before Virtus) and 2027, as worked by hand', async () => {
    const ITEMS: Record<string, string> = {
      i19: 'i19GrossCents', i29: 'i29BasicSmwCents', i34: 'i34BenefitsCents', i35: 'i35DeMinimisCents', i36: 'i36SharesCents', i38: 'i38NonTaxableCents',
      i39: 'i39BasicCents', i52: 'i52TaxableCents', i24: 'i24TaxDueCents', i26: 'i26WithheldCents', dec: 'withheldDecemberCents', janNov: 'withheldJanNovCents', refund: 'refundedCents',
    };
    for (const year of ['2026', '2027']) {
      const all = await get<{ name: string; isMwe: boolean; substitutedFiling: boolean; figures: Record<string, number> }[]>(`/api/pay/2316?year=${year}`);
      expect(all.map((d) => d.name).sort()).toEqual([...EMPLOYEES].sort());
      for (const d of all) {
        const app = Object.fromEntries(Object.entries(ITEMS).map(([k, f]) => [k, d.figures[f]]));
        expect(app, `${d.name} ${year}`).toEqual(Object.fromEntries(Object.keys(ITEMS).map((k) => [k, hand('2316', year, `${d.name}: ${k}`)])));
        expect([d.isMwe, d.substitutedFiling], `${d.name} ${year}`).toEqual([d.name === SEWER, true]);
      }
    }
  });

  it('1604-C alphalist: four employees on schedule 1, the minimum wage earner on schedule 2, totals as the 2316s', async () => {
    for (const year of ['2026', '2027']) {
      const a = await get(`/api/pay/alphalist?year=${year}`);
      const col = (schedule: 1 | 2, name: string) => (a[`columns${schedule}`] as string[]).indexOf(name);
      const total = (schedule: 1 | 2, name: string) => (a[`schedule${schedule}`] as (string | number)[][]).reduce((s, r) => s + (r[col(schedule, name)] as number), 0);
      const sum = (names: readonly string[], item: string) => names.reduce((s, n) => s + hand('2316', year, `${n}: ${item}`), 0);
      const others = EMPLOYEES.filter((n) => n !== SEWER);
      expect(a.schedule1.map((r: unknown[]) => r[2]).sort()).toEqual([...others].sort());
      expect(a.schedule2.map((r: unknown[]) => r[2])).toEqual([SEWER]);
      for (const [schedule, names] of [[1, others], [2, [SEWER]]] as const) {
        expect(total(schedule, 'Gross compensation income, present employer'), `${year} schedule ${schedule}`).toBe(sum(names, 'i19'));
        expect(total(schedule, 'Amount of tax withheld as adjusted'), `${year} schedule ${schedule}`).toBe(sum(names, 'i26'));
      }
    }
  });

  it('1604-E: the year’s EWT per the workings (2026 from the cut-over; the old books’ opened EWT is not on it)', async () => {
    for (const year of ['2026', '2027']) expect((await get(`/api/tax/1604e?year=${year}`)).totals.ewtCents, year).toBe(hand('1604-E', year, 'EWT withheld'));
  });

  it('on 1 January the balance sheet moves the year’s earnings to earlier years’ earnings; assets = liabilities + equity', async () => {
    const e2026 = earnings(TB.get('2026-12-31')!);
    const e2027 = earnings(TB.get('2027-12-31')!) - e2026; // the golden trial balances are cumulative
    const bs = async (asOf: string) => get(`/api/rpt/balance-sheet?asOf=${asOf}`);
    expect(await bs('2026-12-31')).toMatchObject({ currentYearEarningsCents: e2026, earlierYearsEarningsCents: 0, balanced: true });
    expect(await bs('2027-01-01')).toMatchObject({ currentYearEarningsCents: 0, earlierYearsEarningsCents: e2026, balanced: true });
    expect(await bs('2027-12-31')).toMatchObject({ currentYearEarningsCents: e2027, earlierYearsEarningsCents: e2026, balanced: true });
    await y.m.on('2028-01-01');
    const jan = await bs('2028-01-01');
    expect(jan).toMatchObject({ currentYearEarningsCents: 0, earlierYearsEarningsCents: e2026 + e2027, balanced: true });
    expect(jan.totalAssetsCents).toBe((await bs('2027-12-31')).totalAssetsCents);
  });

  it('ties the subledgers to their control accounts at the end', async () => {
    const tb = TB.get('2027-12-31')!;
    const bal = (code: string) => { const r = tb.find((x) => x.code === code); return r ? r.debitCents - r.creditCents : 0; };
    const credit = (code: string) => 0 - bal(code);
    const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
    expect((await get('/api/rpt/ar-aging?asOf=2027-12-31')).totalCents).toBe(bal('1201'));
    expect(sum(await get('/api/ap/suppliers'), (s: { balanceCents: number }) => s.balanceCents)).toBe(credit('2101'));
    expect(sum(await get('/api/ca/employees'), (e: { owedCents: number }) => e.owedCents)).toBe(bal('1210'));
    const all = await get<{ description: string; costCents: number; accumulatedCents: number; status: string }[]>('/api/fa/assets');
    expect(all.map((a) => [a.description, a.status]).sort()).toEqual([['Design laptop', 'in service'], ['Industrial sewing machines', 'disposed'], ['Office computer', 'in service']]);
    const assets = all.filter((a) => a.status !== 'disposed');
    expect(sum(assets, (a) => a.costCents)).toBe(bal('1510') + bal('1520'));
    expect(sum(assets, (a) => a.accumulatedCents)).toBe(credit('1511') + credit('1521'));
    // Both government loans are paid off by payroll: twelve months each, none open at the end.
    expect(await get('/api/pay/loans')).toEqual([]);
    expect((await get<{ loanNo: string; deductedCents: number; leftCents: number; status: string }[]>('/api/pay/loans?status=all')).map((l) => [l.loanNo, l.deductedCents, l.leftCents, l.status]).sort())
      .toEqual([['MPL-2026-0202', 1_080_000, 0, 'ended'], ['SL-2026-0101', 1_200_000, 0, 'ended']]);
  });

  it('keeps every D9 invariant', () => {
    expect(runInvariants(y.m.env.db).filter((r) => !r.ok)).toEqual([]);
  });
});
