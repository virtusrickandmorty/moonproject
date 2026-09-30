/**
 * A year in the life (K51): one made-up shop that switches over to Moonproject on 1 October 2026 (the opening balances wizard,
 * every opening dated the cut-over date) and then works to 31 December 2027, month by month, through the HTTP API the
 * screens use, with a moving clock. What happens is data here; what it should post is worked out by hand in
 * tests/golden/year-workings.md, and the amounts typed on each tax return and remittance are that file's
 * (tests/golden/year.returns.csv), never read back from the app.
 *
 * Every month (the same shape, so the workings can be read month by month):
 *   2nd   rent bill (VAT lessor, EWT 5%)          5th  rent paid           8th  fabric bill (no EWT: not a TWA)
 *   3rd   the academy's job order of 150 jerseys and its 50% downpayment (1% CWT), in the deposit VAT mode of the month
 *   12th  tricycle from petty cash                14th subcontract bill (EWT 2%)   15th electricity voucher, payroll 1
 *   18th  subcontract paid        20th release with invoice, quick sale    26th balance collected (1% CWT)
 *   27th  fabric paid, petty cash topped up       last day: payroll 2, depreciation; at a quarter end the count,
 *         the 2307s in hand and the VAT close
 *   the government office's order in the second month of each quarter (22nd invoice, 24th paid net of 5% VAT and 1% CWT)
 *   remittances, the 1601-C, 0619-E, 1601-EQ, 2550Q, 1702Q and 1702 on their due dates.
 * Payroll twice a month for five employees, one of each kind of pay: monthly office staff above the tax line and below
 * it, a daily-paid minimum wage earner, a piece worker, and a worker paid daily and per piece; two government loans; a
 * cash advance carried over and one given; SIL taken and SIL paid in cash in December; the 13th month by 18 December;
 * the year-end tax adjustment on the last payroll of each year.
 * Deposit VAT modes: A (deposit only) Oct 2026 to Jan 2027, B (VAT on deposit) Feb to May 2027, C (invoice on the
 * downpayment) Jun to Sep 2027, A again from Oct 2027.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestEnv, idem } from '../apps/server/test/helpers.ts';
import { Month } from './month-scenario.ts';

export const CUTOVER = '2026-10-01';
export const LAST_DAY = '2027-12-31';
export const MONTHS = Array.from({ length: 15 }, (_, i) => {
  const n = 2026 * 12 + 9 + i;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
});
export const QUARTER_ENDS = ['2026-12-31', '2027-03-31', '2027-06-30', '2027-09-30', '2027-12-31'];

// ---------- Made-up people and places (AGENTS.md: no real data) ----------
export const ACADEMY = 'Sample Academy';
export const CITY = 'Sample Municipal Office';
export const CLUB = 'Sample Sports Club';
export const FOUNDER = 'Sample Founder';
export const FABRIC = 'Sample Textile Supply';
export const LESSOR = 'Sample Realty Corp.';
export const EMBROIDERY = 'Sample Embroidery Works';
export const DEPOT = 'Sample Office Depot';
export const POWER = 'Sample Power Co.';
export const MANAGER = 'Sample Manager'; // monthly ₱40,000, office, taxed
export const CLERK = 'Sample Clerk'; // monthly ₱16,000, office, below the tax line
export const SEWER = 'Sample Sewer'; // daily ₱550, production, minimum wage earner
export const CUTTER = 'Sample Cutter'; // per piece, production
export const PRINTER = 'Sample Printer'; // daily ₱600 and per piece, production
export const EMPLOYEES = [MANAGER, CLERK, SEWER, CUTTER, PRINTER];
export const MACHINES = 'Industrial sewing machines';
export const COMPUTER = 'Office computer';
export const LAPTOP = 'Design laptop';
export const SSS_LOAN = 'SSS salary loan SL-2026-0101';
export const HDMF_LOAN = 'Pag-IBIG MPL MPL-2026-0202';

/** The seeded 2026 holidays after the cut-over (EMP migration 0001, Proclamation 1006); 2027 has none on file. */
export const HOLIDAYS = new Set(['2026-10-31', '2026-11-01', '2026-11-30', '2026-12-08', '2026-12-24', '2026-12-25', '2026-12-30', '2026-12-31']);

const pad = (n: number) => String(n).padStart(2, '0');
export const lastDayOf = (ym: string) => `${ym}-${pad(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate())}`;
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const addDays = (d: string, n: number) => {
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8) + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
/** The first ten working days (Monday to Saturday, not a holiday on file) of a payroll cutoff. */
export function workdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 10; d = addDays(d, 1)) if (weekday(d) !== 0 && !HOLIDAYS.has(d)) out.push(d);
  if (out.length < 10) throw new Error(`${from} to ${to} has fewer than ten working days`);
  return out;
}
/** A BIR due date moved past Saturdays, Sundays and holidays on file (TAX calendar.ts rule, worked by hand). */
export function dueOn(d: string): string {
  while (weekday(d) === 0 || weekday(d) === 6 || HOLIDAYS.has(d)) d = addDays(d, 1);
  return d;
}
export const nextMonth = (ym: string) => MONTHS[MONTHS.indexOf(ym) + 1] ?? '2028-01';
export const quarterOf = (ym: string) => Math.ceil(+ym.slice(5, 7) / 3);
export const isQuarterEnd = (ym: string) => +ym.slice(5, 7) % 3 === 0;
export const depositMode = (ym: string): 'A' | 'B' | 'C' => (ym >= '2027-02' && ym <= '2027-05' ? 'B' : ym >= '2027-06' && ym <= '2027-09' ? 'C' : 'A');
/** The government office buys in the second month of each quarter. */
export const cityBuys = (ym: string) => +ym.slice(5, 7) % 3 === 2;

// ---------- The amounts the workings put on each return and remittance ----------
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export interface ReturnRow { kind: string; period: string; item: string; cents: number }
/** tests/golden/year.returns.csv: kind,period,item,amount (pesos). */
export function returnsGolden(): ReturnRow[] {
  const [head, ...rows] = readFileSync(`${ROOT}tests/golden/year.returns.csv`, 'utf8').trim().split('\n');
  if (head !== 'kind,period,item,amount') throw new Error('year.returns.csv: bad header');
  return rows.filter((r) => r.trim() && !r.startsWith('#')).map((r) => {
    const [kind, period, item, amount] = r.split(',');
    return { kind: kind!, period: period!, item: item!, cents: Math.round(Number(amount) * 100) };
  });
}

// ---------- The year ----------
interface Event { date: string; seq: number; name: string; run: (y: Year) => Promise<void> }

export class Year {
  readonly m: Month;
  readonly jo: Record<string, string> = {}; // month (or key) → job order id
  readonly inv: Record<string, { id: string; number: string }> = {}; // key → invoice record
  readonly pending2307: { documentId: string; quarterEnd: string }[] = [];
  readonly warnings: { ref: string; code: string; message: string }[] = [];
  private invoiceNo = 1000;
  private crNo = 3000;
  private readonly returns = returnsGolden();

  constructor(m: Month) {
    this.m = m;
  }
  nextInvoice() {
    return String(++this.invoiceNo);
  }
  nextCr() {
    return String(++this.crNo);
  }
  id(name: string) {
    const v = this.m.ids[name];
    if (!v) throw new Error(`No id for ${name}`);
    return v;
  }
  place(code: string) {
    return this.m.places[code]!;
  }
  /** The hand-worked amount of a return or remittance, from year.returns.csv. */
  amount(kind: string, period: string, item = 'paid'): number | undefined {
    return this.returns.find((r) => r.kind === kind && r.period === period && r.item === item)?.cents;
  }
}

/** Previews a document (for the total the person confirms), records it, and keeps the warnings it was recorded with. */
async function post(y: Year, ref: string, type: string, input: object, who: 'acc' | 'enc' | 'own' = 'acc', total?: number) {
  const expectedTotalCents = total ?? (await y.m.call(`/api/docs/${type}/preview`, { input }, who)).totalCents;
  const res = await y.m.call(`/api/docs/${type}/post`, { input, expectedTotalCents }, who, idem());
  for (const w of (res.warnings ?? []) as { code: string; message: string }[]) y.warnings.push({ ref, code: w.code, message: w.message });
  return y.m.record(ref, type, res);
}

async function jobOrder(y: Year, customer: string, lines: { qty: number; unitPriceCents: number; description: string }[], paymentTerms: string) {
  const input = { customerId: y.id(customer), dueInDays: 20, priority: 'normal', paymentTerms, lines: lines.map((l) => ({ kind: 'made_to_order', discountCents: 0, roster: [], ...l })) };
  const total = lines.reduce((s, l) => s + l.qty * l.unitPriceCents, 0);
  return (await y.m.call('/api/docs/jo.job_order/post', { input, expectedTotalCents: total }, 'enc', idem())).id as string;
}

async function releaseWithInvoice(y: Year, ref: string, jo: string, qty: number, grossCents: number) {
  const due = (await y.m.get(`/api/jo/orders/${jo}/status`)).money.balanceDueCents > 0;
  const release = {
    jobOrderId: jo, lines: [{ lineNo: 1, qty }], claimedBy: 'Placeholder Claimant', idSeen: 'company_id',
    ...(due ? { creditNote: 'Balance by bank transfer within the week', creditDueInDays: 7 } : {}),
  };
  const invoiceNumber = y.nextInvoice();
  const res = await y.m.call('/api/jo/releases', { release, invoice: { invoiceNumber }, expectedTotalCents: grossCents }, 'acc', idem());
  const r = y.m.record(ref, 'jo.invoice_record', res.invoiceRecord);
  y.inv[ref] = { id: r.id, number: invoiceNumber };
  return r;
}

const collect = (y: Year, ref: string, customer: string, jobOrderId: string, amountCents: number, tender: { code: string; cents: number }, withholding?: object) =>
  post(y, ref, 'col.collection', {
    customerId: y.id(customer), crNumber: y.nextCr(), applications: [{ jobOrderId, amountCents }],
    tenders: [{ cashPlaceId: y.place(tender.code), amountCents: tender.cents, ...(tender.code === '1111' ? { reference: `BDO-${ref}` } : {}) }],
    ...(withholding ? { withholding } : {}),
  }, 'enc', amountCents);

/** The academy's 150 jerseys at ₱1,120.00 = ₱168,000.00; half down, 1% CWT on the NET of each payment (D4.5). */
export const ACADEMY_ORDER = { qty: 150, unitPriceCents: 112_000, grossCents: 16_800_000, downCents: 8_400_000 };
/** The government office's lot of uniforms: ₱336,000.00 (NET 300,000.00, VAT 36,000.00). */
export const CITY_ORDER = { grossCents: 33_600_000, cwtCents: 300_000, vatWithheldCents: 1_500_000 };

/** Payroll: attendance of the cutoff, both runs, and their releases from BDO. */
async function payroll(y: Year, ym: string, cutoff: 1 | 2) {
  const from = `${ym}-${cutoff === 1 ? '01' : '16'}`;
  const to = cutoff === 1 ? `${ym}-15` : lastDayOf(ym);
  const days = workdays(from, to);
  const leave = ym === '2027-04' && cutoff === 1 ? new Set(['2027-04-06', '2027-04-07']) : new Set<string>(); // the sewer's SIL
  const att = [SEWER, CUTTER, PRINTER].flatMap((name) => days.map((date) => ({ employeeId: y.id(name), date, status: name === SEWER && leave.has(date) ? 'leave' : 'present' })));
  await y.m.call('/api/emp/attendance', { days: att });
  const december = ym.endsWith('-12') && cutoff === 2;
  const extra = december ? { yearEnd: true, unusedLeave: true } : {};
  for (const [group, key] of [['SEMI_MONTHLY', 'office'], ['SEMI_DAILY', 'production']] as const) {
    const ref = `${ym} PAY${cutoff} ${key}`;
    const run = await post(y, ref, 'pay.run', { payGroup: group, periodStart: from, ...extra });
    await release(y, `${ym} POUT${cutoff} ${key}`, run.id);
  }
}

async function release(y: Year, ref: string, runId: string) {
  const run = await y.m.get(`/api/docs/pay.run/${runId}`);
  const employees = run.doc.employees as { employeeId: string; netCents: number }[];
  const net = employees.reduce((s, e) => s + e.netCents, 0);
  await post(y, ref, 'pay.release', { runId, employeeIds: employees.map((e) => e.employeeId), tenders: [{ cashPlaceId: y.place('1111'), amountCents: net }] }, 'acc', net);
}

async function thirteenth(y: Year, year: number) {
  for (const [group, key] of [['SEMI_MONTHLY', 'office'], ['SEMI_DAILY', 'production']] as const) {
    const doc = await post(y, `${year} TH13 ${key}`, 'pay.thirteenth', { payGroup: group, year });
    const t = await y.m.get(`/api/docs/pay.thirteenth/${doc.id}`);
    const employees = t.doc.employees as { employeeId: string; netCents: number }[];
    const net = employees.reduce((s, e) => s + e.netCents, 0);
    await post(y, `${year} TH13 POUT ${key}`, 'pay.release', { runId: doc.id, employeeIds: employees.map((e) => e.employeeId), tenders: [{ cashPlaceId: y.place('1111'), amountCents: net }] }, 'acc', net);
  }
}

/** A remittance or BIR payment of the amount the workings give (year.returns.csv); a period the workings leave at zero is skipped. */
async function remit(y: Year, ref: string, scheme: string, month: string) {
  const cents = y.amount(`REM ${scheme}`, month);
  if (cents === undefined) throw new Error(`year.returns.csv has no REM ${scheme} for ${month}`);
  await post(y, ref, 'stat.remittance', { scheme, month, cashPlaceId: y.place('1111'), amountCents: cents, reference: `PRN-${scheme}-${month}` }, 'acc', cents);
}

async function birPay(y: Year, ref: string, form: string, period: string) {
  const cents = y.amount(form, period);
  if (cents === undefined) throw new Error(`year.returns.csv has no ${form} for ${period}`);
  await post(y, ref, 'tax.bir_payment', { form, period, cashPlaceId: y.place('1111'), amountCents: cents, reference: `EFPS-${form}-${period}` }, 'acc', cents);
}

// ---------- The events ----------
function setupEvents(): Event[] {
  const ev: Event[] = [];
  const on = (date: string, seq: number, name: string, run: Event['run']) => ev.push({ date, seq, name, run });

  on(CUTOVER, 0, 'Master data, booklets and settings', async (y) => {
    const m = y.m;
    const places = await m.get<{ id: number; code: string }[]>('/api/cash/places');
    for (const code of ['1101', '1102', '1111', '1121']) m.places[code] = places.find((p) => p.code === code)!.id;
    const customer = async (name: string, body: object) => (m.ids[name] = m.label('customer', (await m.call('/api/cus/customers', { displayName: name, ...body }, 'enc')).id, name));
    await customer(ACADEMY, { kind: 'organization', registeredName: 'Sample Academy Inc.', tin: '000-555-111-000', isVatRegistered: true, withholdingProfile: 'twa_goods' });
    await customer(CITY, { kind: 'organization', registeredName: 'Sample Municipal Government', tin: '000-555-222-000', isVatRegistered: false, withholdingProfile: 'government' });
    await customer(CLUB, { kind: 'organization' });
    const person = (await m.call('/api/eq/people', { name: FOUNDER, isStockholder: true, isOfficer: true, position: 'President', shares: 10000 })).id;
    m.ids[FOUNDER] = m.label('stockholder', person, FOUNDER);
    m.label('officer', person, FOUNDER);
    const supplier = async (name: string, body: object) => (m.ids[name] = m.label('supplier', (await m.call('/api/pur/suppliers', { name, registeredName: `${name} Inc.`, isVatRegistered: true, ...body })).id, name));
    await supplier(FABRIC, { tin: '222-333-444-000', ewtClass: 'goods_1', paymentTermsDays: 30 });
    await supplier(LESSOR, { tin: '222-333-555-000', ewtClass: 'rent_5' });
    await supplier(EMBROIDERY, { tin: '222-333-666-000', ewtClass: 'contractor_2' });
    await supplier(DEPOT, { tin: '222-333-777-000' });
    m.label('supplier', 'tin:222333888000', POWER);
    for (const c of await m.get<{ id: number; code: string }[]>('/api/exp/categories', 'enc')) m.categories[c.code] = c.id;
    m.ids.twill = (await m.call('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).id;
    const staff: [string, 'office' | 'production', string, object][] = [
      [MANAGER, 'office', '2023-03-01', { payType: 'monthly', monthlyRateCents: 4_000_000, payGroup: 'SEMI_MONTHLY', isMwe: false }],
      [CLERK, 'office', '2025-11-03', { payType: 'monthly', monthlyRateCents: 1_600_000, payGroup: 'SEMI_MONTHLY', isMwe: false }],
      [SEWER, 'production', '2024-06-03', { payType: 'daily', dailyRateCents: 55_000, payGroup: 'SEMI_DAILY', isMwe: true }],
      [CUTTER, 'production', '2024-02-05', { payType: 'piece', payGroup: 'SEMI_DAILY', isMwe: false }],
      [PRINTER, 'production', '2025-02-03', { payType: 'mixed', dailyRateCents: 60_000, payGroup: 'SEMI_DAILY', isMwe: false }],
    ];
    for (const [fullName, costCentre, hireDate, pay] of staff) {
      const e = await m.call('/api/emp/employees', { fullName, costCentre, hireDate, position: costCentre === 'office' ? 'Office staff' : 'Production staff' });
      m.ids[fullName] = m.label('employee', e.id, fullName);
      await m.call(`/api/emp/employees/${e.id}/pay`, { effectiveFrom: hireDate, workweekDays: 6, reason: 'Pay from the old payroll records', ...pay }, 'own');
    }
    await m.stepUp();
    await m.call('/api/tax/booklets', { kind: 'SALES_INVOICE', atpNo: 'OCN 0AU0009990001', printer: 'Made-up Printing Press', serialFrom: 1001, serialTo: 1200, receivedOn: '2026-09-15' });
    await m.call('/api/tax/booklets', { kind: 'CR', atpNo: 'OCN 0AU0009990002', printer: 'Made-up Printing Press', serialFrom: 3001, serialTo: 3200, receivedOn: '2026-09-15' });
    await m.stepUp();
    await m.call('/api/tax/income-tax-settings', {
      effectiveFrom: CUTOVER, value: { regularRateBp: 2000, mcitRateBp: 200, operationsBeganYear: 2019 }, reason: 'Small corporation at 20%, MCIT 2%, operations since 2019 (accountant)',
    });
    await m.call('/api/tax/income-tax-deductions', { year: 2026, method: 'itemized', effectiveFrom: CUTOVER, reason: 'Itemized deductions for 2026 (accountant)' });
    // The pay before Moonproject in 2026 (January to September, the old payroll), for the year-end adjustment and the 2316.
    const before: [string, Record<string, number>][] = [
      [MANAGER, { grossCents: 39_000_000, benefitsCents: 3_000_000, sssCents: 1_575_000, phicCents: 900_000, hdmfCents: 180_000, taxableCents: 33_345_000, wtaxCents: 2_356_380 }],
      [CLERK, { grossCents: 15_600_000, benefitsCents: 1_200_000, sssCents: 720_000, phicCents: 360_000, hdmfCents: 180_000, taxableCents: 13_140_000, wtaxCents: 0 }],
      [SEWER, { grossCents: 10_725_000, benefitsCents: 825_000, sssCents: 495_000, phicCents: 322_785, hdmfCents: 180_000, otherNontaxCents: 8_902_215, taxableCents: 0, wtaxCents: 0 }],
      [CUTTER, { grossCents: 11_700_000, benefitsCents: 900_000, sssCents: 540_000, phicCents: 322_785, hdmfCents: 180_000, taxableCents: 9_757_215, wtaxCents: 0 }],
      [PRINTER, { grossCents: 14_625_000, benefitsCents: 1_125_000, sssCents: 675_000, phicCents: 419_625, hdmfCents: 180_000, taxableCents: 12_225_375, wtaxCents: 0 }],
    ];
    const zero = { deMinimisCents: 0, otherNontaxCents: 0 };
    for (const [name, a] of before) {
      await m.call('/api/pay/prior', { employeeId: y.id(name), year: 2026, source: 'before', ...zero, ...a, note: 'Old payroll, January to September 2026; its 13th month was paid at the cut-over' });
    }
    // Government loans deducted by payroll.
    const loan = async (name: string, body: object) => m.label('loan', (await m.call('/api/pay/loans', { employeeId: y.id(name), ...body })).id, name === SEWER ? SSS_LOAN : HDMF_LOAN);
    m.ids.sssLoan = await loan(SEWER, { kind: 'SSS_SALARY', loanNo: 'SL-2026-0101', amortizationCents: 100_000, firstMonth: '2026-10', lastMonth: '2027-09' });
    m.ids.hdmfLoan = await loan(PRINTER, { kind: 'HDMF_MPL', loanNo: 'MPL-2026-0202', amortizationCents: 90_000, firstMonth: '2026-11', lastMonth: '2027-10' });
  });

  on(CUTOVER, 1, 'Opening balances (the wizard)', async (y) => {
    const m = y.m;
    await m.stepUp();
    await m.call('/api/acc/opening/cutover-date', { date: CUTOVER });
    const acct = async (code: string) => (await m.get<{ accounts: { id: number; code: string }[] }>('/api/acc/opening')).accounts.find((a) => a.code === code)!.id;
    const ob = { businessDate: CUTOVER };
    const o = (ref: string, type: string, input: object, total: number) => m.post(ref, type, input, { ...ob, total });
    await o('OB cash', 'acc.opening', { lines: [
      { accountId: await acct('1101'), debitCents: 5_000_000 }, { accountId: await acct('1102'), debitCents: 500_000 },
      { accountId: await acct('1111'), debitCents: 120_000_000 }, { accountId: await acct('1121'), debitCents: 1_000_000 },
    ] }, 126_500_000);
    await o('OB inventory', 'acc.opening', { lines: [{ accountId: await acct('1301'), debitCents: 6_000_000, memo: 'Count sheet at cost, 30 September' }] }, 6_000_000);
    const joOpening = { dueDate: '2026-10-15', priority: 'normal', paymentTerms: 'dp50' };
    y.jo.academyOld = (await o('OB AR academy', 'jo.opening', { ...joOpening, customerId: y.id(ACADEMY), oldNumber: 'JO 1190', lines: [], depositsCents: 0, receivableCents: 4_480_000, oldInvoices: '0980' }, 4_480_000)).id;
    y.jo.clubOld = (await o('OB deposit club', 'jo.opening', {
      ...joOpening, customerId: y.id(CLUB), oldNumber: 'JO 1201', depositsCents: 1_680_000, depositsMemo: 'Old receipt 2950', receivableCents: 0,
      lines: [{ kind: 'made_to_order', description: 'Club warm-up jackets', qty: 30, unitPriceCents: 112_000, discountCents: 0, roster: [] }],
    }, 3_360_000)).id;
    y.m.ids.billOld = (await o('OB AP fabric', 'ap.opening', { supplierId: y.id(FABRIC), supplierInvoiceNo: 'FT-0931', supplierInvoiceDate: '2026-09-20', dueDate: '2026-10-20', owedCents: 4_480_000 }, 4_480_000)).id;
    const machines = await o('OB FA machines', 'fa.opening', { classCode: 'machinery', description: MACHINES, location: 'Production floor', acquiredOn: '2024-10-01', costCents: 18_600_000, residualCents: 600_000, lifeMonths: 60, accumulatedCents: 7_200_000 }, 18_600_000);
    m.ids[MACHINES] = m.label('asset', machines.id, MACHINES);
    const computer = await o('OB FA computer', 'fa.opening', { classCode: 'computers', description: COMPUTER, location: 'Office', acquiredOn: '2025-04-01', costCents: 3_700_000, residualCents: 100_000, lifeMonths: 36, accumulatedCents: 1_800_000 }, 3_700_000);
    m.ids[COMPUTER] = m.label('asset', computer.id, COMPUTER);
    await o('OB CA cutter', 'ca.opening', { employeeId: y.id(CUTTER), owedCents: 300_000, installmentCents: 50_000, note: 'Balance of the old cash advance sheet' }, 300_000);
    await o('OB 2307', 'tax.opening', { rows: [{ customerId: y.id(ACADEMY), year: 2026, quarter: 3, atc: 'WC158', cwtCents: 120_000, vatWithheldCents: 0, certificate: 'received' }] }, 120_000);
    await o('OB tax payables', 'tax.payable.opening', { rows: [
      { form: '2550Q', period: '2026-Q3', amountCents: 2_400_000 },
      { form: '1601-EQ', period: '2026-Q3', payees: [{ supplierId: y.id(LESSOR), atc: 'WC100', amountCents: 150_000 }, { supplierId: y.id(EMBROIDERY), atc: 'WC120', amountCents: 20_000 }] },
    ] }, 2_570_000);
    await o('OB statutory', 'stat.opening', { month: '2026-09', employees: [
      { employeeId: y.id(MANAGER), sssCents: 528_000, phicCents: 200_000, hdmfCents: 40_000, wtaxCents: 261_820 },
      { employeeId: y.id(CLERK), sssCents: 243_000, phicCents: 80_000, hdmfCents: 40_000 },
      { employeeId: y.id(SEWER), sssCents: 166_000, phicCents: 71_730, hdmfCents: 40_000 },
      { employeeId: y.id(CUTTER), sssCents: 181_000, phicCents: 71_730, hdmfCents: 40_000 },
      { employeeId: y.id(PRINTER), sssCents: 228_000, phicCents: 93_250, hdmfCents: 40_000 },
    ] }, 2_324_530);
    await o('OB equity', 'acc.opening', { lines: [
      { accountId: await acct('3101'), stockholderId: y.id(FOUNDER), creditCents: 100_000_000 },
      { accountId: await acct('3201'), creditCents: 39_645_470, memo: 'Retained earnings to the cut-over date' },
    ] }, 139_645_470);
    await m.stepUp();
    await m.call('/api/acc/opening/close', {});
  });

  // The first weeks: what the opening left to do.
  on('2026-10-05', 30, 'The club’s opened order released on credit', async (y) => {
    for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await y.m.call(`/api/jo/orders/${y.jo.clubOld}/stage`, { from, to }, 'enc');
    await releaseWithInvoice(y, 'CLUB release', y.jo.clubOld!, 30, 3_360_000);
  });
  on('2026-10-07', 30, 'The academy pays the opened receivable', async (y) => {
    const r = await collect(y, 'OB AR paid', ACADEMY, y.jo.academyOld!, 4_480_000, { code: '1111', cents: 4_440_000 }, { cwtCents: 40_000, atc: 'WC158', certificate: 'pending' });
    y.pending2307.push({ documentId: r.id, quarterEnd: '2026-12-31' });
  });
  on('2026-10-20', 30, 'The opened fabric bill paid on its due date', async (y) => {
    await post(y, 'OB AP paid', 'ap.payment', { supplierId: y.id(FABRIC), bills: [{ billId: y.m.ids.billOld!, amountCents: 4_480_000 }], tenders: [{ cashPlaceId: y.place('1111'), amountCents: 4_480_000 }] }, 'enc', 4_480_000);
  });
  // September's statutory payables and the old books' returns, paid on their due dates.
  on(dueOn('2026-10-10'), 40, 'September remittances (opened)', async (y) => {
    for (const s of ['SSS', 'PHIC', 'HDMF', 'WTAX']) await remit(y, `2026-09 REM ${s}`, s, '2026-09');
  });
  on(dueOn('2026-10-25'), 40, '2550Q Q3 2026 (opened)', (y) => birPay(y, '2026-Q3 2550Q', '2550Q', '2026-Q3'));
  on(dueOn('2026-10-31'), 40, '1601-EQ Q3 2026 (opened)', (y) => birPay(y, '2026-Q3 1601-EQ', '1601-EQ', '2026-Q3'));
  return ev;
}

function monthEvents(ym: string): Event[] {
  const ev: Event[] = [];
  const on = (day: string | number, seq: number, name: string, run: Event['run']) => ev.push({ date: typeof day === 'number' ? `${ym}-${pad(day)}` : day, seq, name, run });
  const mode = depositMode(ym);
  const end = lastDayOf(ym);
  const c1 = workdays(`${ym}-01`, `${ym}-15`);
  const c2 = workdays(`${ym}-16`, end);

  if (ym === '2027-02' || ym === '2027-06' || ym === '2027-10') {
    on(1, 0, `Deposit VAT mode ${mode} from today`, async (y) => {
      await y.m.stepUp();
      await y.m.call('/api/settings/sales.deposit_vat_mode', { effectiveFrom: `${ym}-01`, value: mode, reason: `Accountant switches to downpayment VAT mode ${mode}` });
    });
  }
  on(2, 10, 'Rent bill', async (y) => {
    const r = await post(y, `${ym} RENT`, 'ap.bill', { supplierId: y.id(LESSOR), supplierInvoiceNo: `SR-${ym}`, supplierInvoiceDate: `${ym}-02`, dueDate: `${ym}-05`, lines: [{ categoryId: y.m.categories['6110']!, description: `Shop rent ${ym}`, amountCents: 3_360_000 }] }, 'enc');
    y.m.ids[`rent ${ym}`] = r.id;
  });
  on(3, 10, 'Academy order and downpayment', async (y) => {
    const jo = await jobOrder(y, ACADEMY, [{ qty: 150, unitPriceCents: ACADEMY_ORDER.unitPriceCents, description: 'Varsity jersey set' }], 'dp50');
    y.jo[ym] = jo;
    await y.m.call(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [4, 6, 8], garmentType: 'Jersey', complexity: 'standard' }, 'acc');
    if (mode === 'C') {
      await post(y, `${ym} DPINV`, 'jo.dp_invoice', { jobOrderId: jo, invoiceNumber: y.nextInvoice(), amountCents: ACADEMY_ORDER.downCents }, 'enc', ACADEMY_ORDER.downCents);
    }
    const r = await collect(y, `${ym} DP`, ACADEMY, jo, ACADEMY_ORDER.downCents, { code: '1111', cents: ACADEMY_ORDER.downCents - 75_000 }, { cwtCents: 75_000, atc: 'WC158', certificate: 'pending' });
    y.pending2307.push({ documentId: r.id, quarterEnd: quarterEndOf(ym) });
  });
  on(5, 10, 'Rent paid', (y) => post(y, `${ym} RENT paid`, 'ap.payment', { supplierId: y.id(LESSOR), bills: [{ billId: y.m.ids[`rent ${ym}`]!, amountCents: 3_210_000 }], tenders: [{ cashPlaceId: y.place('1111'), amountCents: 3_210_000 }] }, 'enc', 3_210_000).then(() => undefined));
  on(8, 10, 'Fabric bill', async (y) => {
    y.m.ids[`fabric ${ym}`] = (await post(y, `${ym} FABRIC`, 'ap.bill', { supplierId: y.id(FABRIC), supplierInvoiceNo: `FT-${ym}`, supplierInvoiceDate: `${ym}-08`, lines: [{ supplyId: y.m.ids.twill!, amountCents: 4_480_000 }] }, 'enc')).id;
  });
  on(c1[3]!, 20, 'Cutting (piece work)', (y) =>
    post(y, `${ym} PE cut`, 'prd.entry', { jobOrderId: y.jo[ym]!, stepId: 4, rows: [{ lineNo: 1, employeeId: y.id(CUTTER), pieces: 150, rateCents: 4_000, rateReason: 'Shop rate for cutting a jersey set' }] }, 'enc', 600_000).then(() => undefined));
  on(12, 10, 'Tricycle from petty cash', (y) =>
    post(y, `${ym} TRIKE`, 'exp.voucher', { categoryId: y.m.categories['6140']!, cashPlaceId: y.place('1102'), amountCents: 30_000, description: 'Tricycle to the fabric store', payeeName: 'Tricycle driver' }, 'enc', 30_000).then(() => undefined));
  on(14, 10, 'Subcontract bill', async (y) => {
    y.m.ids[`embroidery ${ym}`] = (await post(y, `${ym} EMB`, 'ap.bill', { supplierId: y.id(EMBROIDERY), supplierInvoiceNo: `EW-${ym}`, supplierInvoiceDate: `${ym}-14`, lines: [{ purchase: 'subcontract', description: 'Logo embroidery', amountCents: 1_120_000 }] }, 'enc')).id;
  });
  on(15, 10, 'Electricity', (y) =>
    post(y, `${ym} POWER`, 'exp.voucher', {
      categoryId: y.m.categories['6120']!, cashPlaceId: y.place('1111'), amountCents: 896_000, description: `Electricity ${ym}`, payeeName: POWER, payeeVatRegistered: true,
      payeeTin: '222-333-888-000', supplierInvoiceNo: `PW-${ym}`, supplierInvoiceDate: `${ym}-15`,
    }, 'enc', 896_000).then(() => undefined));
  on(15, 50, 'Payroll 1–15', (y) => payroll(y, ym, 1));
  on(c2[1]!, 20, 'Sewing (piece work)', (y) =>
    post(y, `${ym} PE sew`, 'prd.entry', {
      jobOrderId: y.jo[ym]!, stepId: 6, rows: [
        { lineNo: 1, employeeId: y.id(CUTTER), pieces: 100, rateCents: 6_000, rateReason: 'Shop rate for sewing a jersey set' },
        { lineNo: 1, employeeId: y.id(PRINTER), pieces: 50, rateCents: 6_000, rateReason: 'Shop rate for sewing a jersey set' },
      ],
    }, 'enc', 900_000).then(() => undefined));
  on(18, 10, 'Subcontract paid', (y) => post(y, `${ym} EMB paid`, 'ap.payment', { supplierId: y.id(EMBROIDERY), bills: [{ billId: y.m.ids[`embroidery ${ym}`]!, amountCents: 1_100_000 }], tenders: [{ cashPlaceId: y.place('1111'), amountCents: 1_100_000 }] }, 'enc', 1_100_000).then(() => undefined));
  on(20, 10, 'Release with invoice; quick sale', async (y) => {
    await y.m.call(`/api/jo/orders/${y.jo[ym]}/stage`, { from: 'in_production', to: 'ready' }, 'enc');
    await releaseWithInvoice(y, `${ym} INV`, y.jo[ym]!, 150, ACADEMY_ORDER.grossCents);
    const sale = { customerId: y.id(CLUB), invoiceNumber: y.nextInvoice(), lines: [{ kind: 'service', description: 'Alteration of club uniforms', qty: 1, unitPriceCents: 224_000, discountCents: 0 }] };
    const res = await y.m.call('/api/qs/sales', { sale, payment: { crNumber: y.nextCr(), tenders: [{ cashPlaceId: y.place('1101'), amountCents: 224_000 }] }, expectedTotalCents: 224_000 }, 'enc', idem());
    y.m.record(`${ym} QS`, 'qs.sale', res.sale);
    y.m.record(`${ym} QS paid`, 'col.collection', res.payment);
  });
  if (cityBuys(ym)) {
    on(22, 10, 'Government order released on credit', async (y) => {
      const jo = await jobOrder(y, CITY, [{ qty: 1, unitPriceCents: CITY_ORDER.grossCents, description: 'Office uniforms, one lot' }], 'net30');
      y.jo[`${ym} city`] = jo;
      for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await y.m.call(`/api/jo/orders/${jo}/stage`, { from, to }, 'enc');
      await releaseWithInvoice(y, `${ym} CITY INV`, jo, 1, CITY_ORDER.grossCents);
    });
    on(24, 10, 'Government office pays net of 5% VAT and 1% CWT', (y) =>
      collect(y, `${ym} CITY paid`, CITY, y.jo[`${ym} city`]!, CITY_ORDER.grossCents, { code: '1111', cents: CITY_ORDER.grossCents - CITY_ORDER.cwtCents - CITY_ORDER.vatWithheldCents },
        { cwtCents: CITY_ORDER.cwtCents, atc: 'WC158', certificate: 'received', vatWithheldCents: CITY_ORDER.vatWithheldCents }).then(() => undefined));
  }
  const memo = ym === '2026-11';
  if (memo) {
    on(23, 10, 'Credit memo: allowance on this month’s invoice', (y) =>
      post(y, `${ym} CM`, 'col.credit_memo', { invoiceId: y.inv[`${ym} INV`]!.id, kind: 'allowance', amountCents: 560_000, formNumber: '0101', reason: 'Five sets delivered with the wrong print' }, 'acc', 560_000).then(() => undefined));
  }
  on(26, 10, 'Balance collected', async (y) => {
    const balance = ACADEMY_ORDER.grossCents - ACADEMY_ORDER.downCents - (memo ? 560_000 : 0);
    const cwt = memo ? 70_000 : 75_000; // 1% of NET(78,400.00) = 700.00; else 1% of NET(84,000.00) = 750.00
    const r = await collect(y, `${ym} BAL`, ACADEMY, y.jo[ym]!, balance, { code: '1111', cents: balance - cwt }, { cwtCents: cwt, atc: 'WC158', certificate: 'pending' });
    y.pending2307.push({ documentId: r.id, quarterEnd: quarterEndOf(ym) });
  });
  on(27, 10, 'Fabric paid; petty cash topped up', async (y) => {
    await post(y, `${ym} FABRIC paid`, 'ap.payment', { supplierId: y.id(FABRIC), bills: [{ billId: y.m.ids[`fabric ${ym}`]!, amountCents: 4_480_000 }], tenders: [{ cashPlaceId: y.place('1111'), amountCents: 4_480_000 }] }, 'enc', 4_480_000);
    await post(y, `${ym} PETTY`, 'cash.transfer', { fromCashPlaceId: y.place('1101'), toCashPlaceId: y.place('1102'), amountSentCents: 30_000, amountReceivedCents: 30_000 }, 'enc', 30_000);
  });
  on(end, 50, 'Payroll 16–end', (y) => payroll(y, ym, 2));
  on(end, 70, 'Depreciation', (y) => post(y, `${ym} DEPR`, 'fa.depreciation', { month: ym }).then(() => undefined));
  if (isQuarterEnd(ym)) {
    const counted: Record<string, number> = { '2026-12': 500_000, '2027-03': 464_000, '2027-06': 488_000, '2027-09': 512_000, '2027-12': 480_000 };
    on(end, 75, 'Inventory count', (y) =>
      post(y, `${ym} COUNT`, 'inv.count', { category: 'materials', lines: [{ supplyId: y.m.ids.twill!, qty: counted[ym]!, unitCostCents: 12_500, costReason: 'The supplier’s current price list' }] }).then(() => undefined));
    on(end, 78, '2307s of the quarter in hand', async (y) => {
      for (const p of y.pending2307.filter((x) => x.quarterEnd === end)) await y.m.call('/api/tax/2307s/received', { documentId: p.documentId, lineNo: 0 });
    });
    on(end, 80, 'VAT close', (y) => post(y, `${ym.slice(0, 4)}-Q${quarterOf(ym)} VATC`, 'tax.vat_close', { year: +ym.slice(0, 4), quarter: quarterOf(ym) }).then(() => undefined));
  }

  // Due dates of this month's remittances and returns (in the next month).
  const nm = nextMonth(ym);
  if (nm <= '2027-12') {
    const tenth = ym.endsWith('-12') ? `${nm}-15` : `${nm}-10`;
    on(dueOn(tenth), 40, `${ym} remittances and 1601-C`, async (y) => {
      for (const s of ['SSS', 'PHIC', 'HDMF', 'WTAX']) await remit(y, `${ym} REM ${s}`, s, ym);
    });
    if (!isQuarterEnd(ym)) on(dueOn(`${nm}-10`), 41, `${ym} 0619-E`, (y) => birPay(y, `${ym} 0619-E`, '0619-E', ym));
    if (isQuarterEnd(ym)) {
      const q = `${ym.slice(0, 4)}-Q${quarterOf(ym)}`;
      on(dueOn(`${nm}-25`), 42, `${q} 2550Q`, (y) => birPay(y, `${q} 2550Q`, '2550Q', q));
      on(dueOn(lastDayOf(nm)), 43, `${q} 1601-EQ`, (y) => birPay(y, `${q} 1601-EQ`, '1601-EQ', q));
    }
  }
  return ev;
}

const quarterEndOf = (ym: string) => lastDayOf(`${ym.slice(0, 4)}-${pad(quarterOf(ym) * 3)}`);

function yearEvents(): Event[] {
  const ev: Event[] = [];
  const on = (date: string, seq: number, name: string, run: Event['run']) => ev.push({ date, seq, name, run });
  on('2026-12-18', 60, '13th month 2026', (y) => thirteenth(y, 2026));
  on('2026-12-31', 90, 'Income tax provision 2026', (y) => post(y, '2026 ITP', 'tax.it_provision', { year: 2026 }).then(() => undefined));
  on('2027-01-04', 0, 'Deductions of 2027', async (y) => {
    await y.m.stepUp();
    await y.m.call('/api/tax/income-tax-deductions', { year: 2027, method: 'itemized', effectiveFrom: '2027-01-04', reason: 'Itemized deductions for 2027 (accountant)' });
  });
  on('2027-02-10', 10, 'Design laptop bought', async (y) => {
    const r = await post(y, '2027-02 FA laptop', 'fa.buy', {
      classCode: 'computers', description: LAPTOP, location: 'Office', supplierId: y.id(DEPOT), supplierInvoiceNo: 'OD-5521', supplierInvoiceDate: '2027-02-10',
      amountCents: 8_064_000, residualCents: 0, lifeMonths: 36, cashPlaceId: y.place('1111'), paidCents: 8_064_000,
    }, 'acc', 8_064_000);
    y.m.ids[LAPTOP] = y.m.label('asset', r.id, LAPTOP);
  });
  on('2027-03-03', 10, 'Cash advance to the sewer', (y) =>
    post(y, '2027-03 CA sewer', 'ca.advance', { employeeId: y.id(SEWER), cashPlaceId: y.place('1101'), amountCents: 200_000, installmentCents: 100_000 }, 'acc', 200_000).then(() => undefined));
  on('2027-04-15', 10, 'Income tax settlement 2026 and the 1702', async (y) => {
    await post(y, '2026 ITS', 'tax.it_settlement', { year: 2026 });
    await birPay(y, '2026 1702', '1702', '2026');
  });
  for (const [q, due] of [['2027-Q1', '2027-05-30'], ['2027-Q2', '2027-08-29'], ['2027-Q3', '2027-11-29']] as const) {
    on(dueOn(due), 44, `${q} 1702Q`, (y) => birPay(y, `${q} 1702Q`, '1702Q', q));
  }
  on('2027-06-30', 10, 'Club receivable written off', (y) =>
    post(y, '2027-06 BDW', 'col.write_off', { invoiceId: y.inv['CLUB release']!.id, reason: 'The club has closed; nothing more will be collected' }, 'acc').then(() => undefined));
  on('2027-08-31', 72, 'Sewing machines sold', (y) =>
    post(y, '2027-08 FA sale', 'fa.disposal', {
      assetId: y.id(MACHINES), kind: 'sale', reason: 'Sold to another shop after the upgrade', invoiceNumber: y.nextInvoice(), amountCents: 10_080_000, cashPlaceId: y.place('1111'),
      buyerName: 'Sample Tailoring Shop', buyerAddress: 'Made-up Street, Sample Town', buyerTin: '333-444-555-000',
    }, 'acc', 10_080_000).then((r) => void y.m.label('customer', r.id, 'Sample Tailoring Shop')));
  on('2027-12-17', 60, '13th month 2027', (y) => thirteenth(y, 2027));
  on('2027-12-31', 90, 'Income tax provision and settlement 2027', async (y) => {
    await post(y, '2027 ITP', 'tax.it_provision', { year: 2027 });
    await post(y, '2027 ITS', 'tax.it_settlement', { year: 2027 });
  });
  return ev;
}

export function events(): Event[] {
  return [...setupEvents(), ...MONTHS.flatMap(monthEvents), ...yearEvents()].sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
}

/** Runs the whole year on a fresh in-memory shop, optionally stopping after a date. */
export async function runYear(until = LAST_DAY): Promise<Year> {
  const env = await createTestEnv(`${CUTOVER}T02:00:00Z`);
  const y = new Year(new Month(env));
  for (const e of events()) {
    if (e.date > until) break;
    try {
      await y.m.on(e.date);
      await e.run(y);
    } catch (err) {
      throw new Error(`${e.date} ${e.name}: ${(err as Error).message}`);
    }
  }
  return y;
}
