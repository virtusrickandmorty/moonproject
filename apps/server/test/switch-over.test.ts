/**
 * Practice switch-over (PLAN D8 "Cut-over", J4 "Switch-over plan", E10, golden G-27 scaled up): a rehearsal of cut-over day
 * on 2026-10-01 through the HTTP API, with made-up names and the kinds of figures the plan names, then the first day's
 * work on top of the opened books, then the first month end. Tests only: nothing here changes the engine, a document type
 * or a migration.
 *
 * Every figure below is worked out by hand from the plan's rules, never copied from the app.
 *
 *   Cash (J4 step 3): the cash-box count sheet 62 × 1,000 + 31 × 500 + 48 × 200 + 77 × 100 + 40 × 50 + 55 × 20 + 120 × 10 + 86 × 5
 *     + 150 × 1 = 62,000 + 15,500 + 9,600 + 7,700 + 2,000 + 1,100 + 1,200 + 430 + 150 = 99,680.00. With petty cash 5,000.00, checks
 *     on hand 12,500.00, BDO 1,286,440.75, China Bank 210,000.00 and GCash 8,325.50 the cash places hold 1,621,946.25.
 *   Inventory: materials 342,750.00 and ready-made 48,600.00 at cost = 391,350.00. Input VAT carried over 18,640.25, prepaid
 *     expenses 12,000.00.
 *   Open job orders: two not yet released with deposits held (28,000.00 on a 56,000.00 order; 9,000.00 on an 18,000.00 order),
 *     two released with a balance owed (15,000.00 and 22,500.00). 2201 = 37,000.00, 1201 = 37,500.00.
 *   Supplier bills: equipment payable 384,511.10 + 62,340.00 + 18,275.50 = 465,126.60.
 *   Investment loans: 500,000.00 + 238,900.00 = 738,900.00 (12% a year, 13 monthly instalments left).
 *   Cash advances per employee: 2,000.00 + 5,500.00 + 12,750.00 = 20,250.00. Officers: one is owed 120,000.00 by the shop, one
 *     owes the shop 15,000.00.
 *   Old equipment 553,118.90 = 300,000.00 + 180,000.00 + 73,118.90. Accumulated depreciation on the straight line through the
 *     old books' last month (September 2026): (300,000 − 30,000) × 23 ÷ 60 = 103,500.00; (180,000 − 18,000) × 19 ÷ 60 = 51,300.00;
 *     (73,118.90 − 1,118.90) × 16 ÷ 36 = 32,000.00; together 186,800.00, so the book value is 366,318.90.
 *   2307s not yet used: 3,250.00 in hand and 1,200.00 still to come = 4,450.00 of creditable withholding tax.
 *   Equity that makes 3900 = 0 (Cr 3900 before it, worked as the sum of the other sides):
 *     assets 1,621,946.25 + 391,350.00 + 18,640.25 + 12,000.00 + receivables 37,500.00 + advances 20,250.00 + officer 15,000.00
 *     + equipment book value 366,318.90 + CWT 4,450.00 = 2,487,455.40
 *     less deposits 37,000.00, bills 465,126.60, loans 738,900.00, due to officer 120,000.00 = 1,361,026.60
 *     leaves 1,126,428.80 = capital stock 500,000.00 + APIC 100,000.00 + retained earnings 526,428.80.
 *   Opening trial balance: debits 2,674,255.40 = credits 2,674,255.40.
 *
 *   First day (2026-10-02): a 15,000.00 collection in cash on the opened JO 1150; 10,000.00 by GCash on JO 1164 (12,500.00 left);
 *     the release of the 20 jerseys of JO 1187 = 56,000.00 gross, VAT 56,000 × 12 ÷ 112 = 6,000.00, sales 50,000.00, the opened
 *     deposit of 28,000.00 applied, 28,000.00 left to collect; 100,000.00 on the equipment bill and the 18,275.50 thread bill
 *     paid in full from BDO; the first instalment of the 500,000.00 loan: interest 500,000 × 12% ÷ 12 = 5,000.00 and, from the
 *     level payment 500,000 × 1% ÷ (1 − 1.01^-13) = 41,207.41, principal 36,207.41; the end-of-day count of the cash box, 50.00
 *     short of the 114,680.00 the books hold (99,680.00 + 15,000.00).
 *   October's inventory count (2026-10-31): materials 2,500 yd × 120.00 + 900 cones × 50.00 = 345,000.00 against 342,750.00 in
 *     the books, 2,250.00 more; ready-made 138 × 350.00 = 48,300.00 against 48,600.00, 300.00 less.
 *   Depreciation: the old books were on the straight line through September, the month before the cut-over (dated the 1st), so
 *     October and November each charge the straight line: 4,500.00 + 2,700.00 + 2,000.00 = 9,200.00.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from './helpers.ts';
import { runInvariants } from '../src/engine/ledger/invariants.ts';
import { seedCustomers } from '../src/modules/JO/tests/cus-fixture.ts';
import { addEmployee } from '../src/modules/EMP/tests/fixture.ts';

const CUTOVER = '2026-10-01';

let env: TestEnv;
let accountant: Client;
let owner: Client;
let encoder: Client;
let c: ReturnType<typeof seedCustomers>;

/** Made-up people and places, filled in beforeAll. */
const who = {} as {
  equipment: string; fabric: string; thread: string; // suppliers
  officerA: string; officerB: string; // stockholders and officers
  ana: string; ben: string; cara: string; // employees
};
const opened: Record<string, { id: string; number: string }> = {};

const id = (code: string) => cashPlaceId(env.db, code);
const stepUp = (who: Client) => who.post('/api/auth/step-up', { password: PASSWORD });
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
/** Signs everyone in again after the clock moves (a session lasts the day). */
const goTo = async (iso: string) => {
  env.clock.set(iso);
  [accountant, owner, encoder] = [await env.as('accountant'), await env.as('owner'), await env.as('encoder')];
};

type Recorded = { id: string; number: string; businessDate: string; totalCents: number; journalNumber: string | null; summary: string; warnings: { code: string }[] };
const record = async (type: string, input: object, expectedTotalCents: number, o: { by?: Client; date?: string | null } = {}): Promise<Recorded> => {
  const date = o.date === undefined ? CUTOVER : o.date;
  const r = await (o.by ?? accountant).post(`/api/docs/${type}/post`, { input, expectedTotalCents, ...(date ? { businessDate: date } : {}) }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
};
const issueCodes = async (type: string, input: object, level = 'error', date: string | null = CUTOVER) => {
  const r = await accountant.post(`/api/docs/${type}/preview`, { input, ...(date ? { businessDate: date } : {}) });
  expect(r.statusCode, r.body).toBe(200);
  return (r.json().issues as { code: string; level: string }[]).filter((i) => i.level === level).map((i) => i.code);
};
/** A document's journal: [account, party, debit, credit] per line, and the business date of every one of them. */
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.source_type = 'document' AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind) as [string, string | null, number, number][];
const journalDates = (documentId: string) =>
  env.db.prepare(`SELECT DISTINCT business_date FROM journals WHERE source_id = ? AND source_type = 'document'`).pluck().all(documentId) as string[];
const get = async (who: Client, url: string) => {
  const r = await who.get(url);
  expect(r.statusCode, `${url}: ${r.body}`).toBe(200);
  return r.json();
};
const sorted = <T extends unknown[]>(rows: T[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const sumCredit = (code: string) => -(balances(env.db)[code] ?? 0);

// The made-up documents ------------------------------------------------------------------------------------------------

/** The count sheet of the main cash box at closing time on 2026-09-30, by bill and coin (centavos). */
const COUNT_SHEET = [
  { denominationCents: 100_000, qty: 62 }, { denominationCents: 50_000, qty: 31 }, { denominationCents: 20_000, qty: 48 },
  { denominationCents: 10_000, qty: 77 }, { denominationCents: 5_000, qty: 40 }, { denominationCents: 2_000, qty: 55 },
  { denominationCents: 1_000, qty: 120 }, { denominationCents: 500, qty: 86 }, { denominationCents: 100, qty: 150 },
];
const COUNTED_CASH = 9_968_000; // ₱99,680.00, worked in the header

const joInput = (o: object) => ({ dueDate: '2026-10-05', priority: 'normal', paymentTerms: 'dp50', lines: [], depositsCents: 0, receivableCents: 0, ...o });
const jerseys = (qty: number, unitPriceCents: number) => ({ kind: 'made_to_order', description: 'Team jersey set', discountCents: 0, roster: [], qty, unitPriceCents });

const assetInputs = () => [
  { classCode: 'machinery', description: 'Embroidery machine', location: 'Production floor', acquiredOn: '2024-11-05', costCents: 30_000_000, residualCents: 3_000_000, lifeMonths: 60, accumulatedCents: 10_350_000 },
  { classCode: 'machinery', description: 'Sewing machines and cutting table', location: 'Production floor', acquiredOn: '2025-03-10', costCents: 18_000_000, residualCents: 1_800_000, lifeMonths: 60, accumulatedCents: 5_130_000 },
  { classCode: 'computers', description: 'Office computers and printer', location: 'Office', acquiredOn: '2025-06-20', costCents: 7_311_890, residualCents: 111_890, lifeMonths: 36, accumulatedCents: 3_200_000 },
];

/** A fresh shop on 2026-10-01: the made-up customers, suppliers, officers and employees, nothing opened yet. */
async function newShop() {
  for (const k of Object.keys(opened)) delete opened[k];
  env = await createTestEnv('2026-10-01T02:00:00Z'); // 10:00 Manila, Thursday 1 October 2026
  [accountant, owner, encoder] = [await env.as('accountant'), await env.as('owner'), await env.as('encoder')];
  c = seedCustomers(env.db, encoder.userId); // Moonlight Test School (c.school), Paper Lantern Club (c.other)
  const supplier = async (name: string, tin: string) =>
    (await accountant.post('/api/pur/suppliers', { name, registeredName: `${name} Inc.`, isVatRegistered: true, tin, ewtClass: 'contractor_2' })).json().id as string;
  who.equipment = await supplier('Sample Equipment Supply', '444-555-666-000');
  who.fabric = await supplier('Sample Fabric House', '444-555-777-000');
  who.thread = await supplier('Sample Thread Co', '444-555-888-000');
  const person = async (name: string, position: string) => (await accountant.post('/api/eq/people', { name, isStockholder: true, isOfficer: true, position })).json().id as string;
  who.officerA = await person('Sample Officer A', 'President');
  who.officerB = await person('Sample Officer B', 'Treasurer');
  who.ana = addEmployee(env.db, 'Ana Sample');
  who.ben = addEmployee(env.db, 'Ben Example');
  who.cara = addEmployee(env.db, 'Cara Placeholder');
}

beforeAll(newShop);

describe('cut-over day, 2026-10-01: the opening (J4 step 3, D8)', () => {
  it('the accountant sets the cut-over date; nothing is open yet', async () => {
    await stepUp(accountant);
    const r = await accountant.post('/api/acc/opening/cutover-date', { date: CUTOVER });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ cutoverDate: CUTOVER, openingEquityCents: 0, closed: null, documents: [] });
  });

  it('cash: the count sheet adds up to the box, and the cash places open Dr cash / Cr 3900', async () => {
    expect(COUNT_SHEET.reduce((s, l) => s + l.denominationCents * l.qty, 0)).toBe(COUNTED_CASH);
    const lines = [
      { accountId: id('1101'), debitCents: COUNTED_CASH, memo: 'Cash box count sheet, closing time 30 September' },
      { accountId: id('1102'), debitCents: 500_000 },
      { accountId: id('1103'), debitCents: 1_250_000, memo: 'Checks on hand, not yet deposited' },
      { accountId: id('1111'), debitCents: 128_644_075, memo: 'BDO statement balance' },
      { accountId: id('1112'), debitCents: 21_000_000, memo: 'China Bank statement balance' },
      { accountId: id('1121'), debitCents: 832_550, memo: 'GCash balance' },
    ];
    const r = await record('acc.opening', { lines }, 162_194_625);
    opened.cash = r;
    expect(r).toMatchObject({ number: 'OB-000001', businessDate: CUTOVER });
    expect(journalOf(r.id)).toEqual([
      ['1101', null, 9_968_000, 0], ['1102', null, 500_000, 0], ['1103', null, 1_250_000, 0], ['1111', null, 128_644_075, 0],
      ['1112', null, 21_000_000, 0], ['1121', null, 832_550, 0], ['3900', null, 0, 162_194_625],
    ]);
    expect(journalDates(r.id)).toEqual([CUTOVER]);
    expect(balances(env.db)['3900']).toBe(-162_194_625);
  });

  it('inventory at cost and the VAT and prepaid carry-overs open on their own accounts (no document keeps their detail)', async () => {
    const inv = await record('acc.opening', {
      lines: [{ accountId: id('1301'), debitCents: 34_275_000, memo: 'Count sheet: materials at cost' }, { accountId: id('1302'), debitCents: 4_860_000, memo: 'Count sheet: ready-made at cost' }],
    }, 39_135_000);
    expect(inv.number).toBe('OB-000002');
    expect(journalOf(inv.id)).toEqual([['1301', null, 34_275_000, 0], ['1302', null, 4_860_000, 0], ['3900', null, 0, 39_135_000]]);
    const carry = await record('acc.opening', {
      lines: [{ accountId: id('1402'), debitCents: 1_864_025, memo: 'Input VAT carried over from the 2550Q' }, { accountId: id('1420'), debitCents: 1_200_000, memo: 'Prepaid insurance' }],
    }, 3_064_025);
    expect(journalOf(carry.id)).toEqual([['1402', null, 1_864_025, 0], ['1420', null, 1_200_000, 0], ['3900', null, 0, 3_064_025]]);
  });

  it('the wizard refuses accounts that a document must open (2101, 2201, 1201, 2601, 1510, 1210, 1410 and 3900 itself)', async () => {
    for (const code of ['1201', '2201', '2101', '2601', '1510', '1210', '1410', '3900']) {
      expect(await issueCodes('acc.opening', { lines: [{ accountId: id(code), debitCents: 100 }] }), code).not.toEqual([]);
    }
  });

  it('open job orders: deposits held on two, a balance owed on two released; each is a document, not a lump sum', async () => {
    const specs = [
      { key: 'jo1', input: joInput({ customerId: c.school, oldNumber: 'JO 1187', lines: [jerseys(20, 280_000)], depositsCents: 2_800_000, depositsMemo: 'Old receipt 3310' }), total: 5_600_000, expect: [['3900', null, 2_800_000, 0], ['2201', c.school, 0, 2_800_000]] },
      { key: 'jo2', input: joInput({ customerId: c.other, oldNumber: 'JO 1203', lines: [jerseys(12, 150_000)], depositsCents: 900_000 }), total: 1_800_000, expect: [['3900', null, 900_000, 0], ['2201', c.other, 0, 900_000]] },
      { key: 'jo3', input: joInput({ customerId: c.school, oldNumber: 'JO 1150', receivableCents: 1_500_000, oldInvoices: '0412, 0413' }), total: 1_500_000, expect: [['1201', c.school, 1_500_000, 0], ['3900', null, 0, 1_500_000]] },
      { key: 'jo4', input: joInput({ customerId: c.other, oldNumber: 'JO 1164', receivableCents: 2_250_000, oldInvoices: '0433' }), total: 2_250_000, expect: [['1201', c.other, 2_250_000, 0], ['3900', null, 0, 2_250_000]] },
    ];
    for (const s of specs) {
      const r = await record('jo.opening', s.input, s.total);
      opened[s.key] = r;
      expect(journalOf(r.id), s.key).toEqual(s.expect);
      expect(journalDates(r.id)).toEqual([CUTOVER]);
    }
    expect(opened.jo1!.number).toBe('OBJO-000001');
    expect(balances(env.db)['2201']).toBe(-3_700_000);
    expect(balances(env.db)['1201']).toBe(3_750_000);
  });

  it('supplier bills still open, one of them the equipment payable of 384,511.10', async () => {
    const bills = [
      { key: 'billEquipment', supplierId: who.equipment, no: 'SI-2211', on: '2026-03-15', due: '2026-10-15', cents: 38_451_110 },
      { key: 'billFabric', supplierId: who.fabric, no: 'FH-8841', on: '2026-08-26', due: '2026-09-25', cents: 6_234_000 },
      { key: 'billThread', supplierId: who.thread, no: 'TC-1207', on: '2026-09-22', due: '2026-10-22', cents: 1_827_550 },
    ];
    for (const b of bills) {
      const r = await record('ap.opening', { supplierId: b.supplierId, supplierInvoiceNo: b.no, supplierInvoiceDate: b.on, dueDate: b.due, owedCents: b.cents }, b.cents);
      opened[b.key] = r;
      expect(journalOf(r.id), b.key).toEqual([['3900', null, b.cents, 0], ['2101', b.supplierId, 0, b.cents]]);
    }
    expect(balances(env.db)['2101']).toBe(-46_512_660);
  });

  it('investment loans of 738,900.00 with their schedules', async () => {
    const a = await record('loan.opening', { lender: 'Sample Investor A', kind: 'loan', originalPrincipalCents: 60_000_000, dateReceived: '2025-11-10', principalCents: 50_000_000, interestRateBp: 1200, monthsLeft: 13, schedule: 'declining', nextDueDate: '2026-10-15', reference: 'PN 2025-011' }, 50_000_000);
    const b = await record('loan.opening', { lender: 'Sample Investor B', kind: 'loan', originalPrincipalCents: 30_000_000, dateReceived: '2026-01-20', principalCents: 23_890_000, interestRateBp: 1200, monthsLeft: 13, schedule: 'declining', nextDueDate: '2026-10-20', reference: 'PN 2026-002' }, 23_890_000);
    [opened.loanA, opened.loanB] = [a, b];
    expect(journalOf(a.id)).toEqual([['3900', null, 50_000_000, 0], ['2601', a.id, 0, 50_000_000]]);
    expect(journalOf(b.id)).toEqual([['3900', null, 23_890_000, 0], ['2601', b.id, 0, 23_890_000]]);
    expect(balances(env.db)['2601']).toBe(-73_890_000);
  });

  it('cash advances per employee, and the officers\' balances', async () => {
    const advances = [
      { key: 'caAna', employeeId: who.ana, owedCents: 200_000, installmentCents: 100_000 },
      { key: 'caBen', employeeId: who.ben, owedCents: 550_000, installmentCents: 50_000 },
      { key: 'caCara', employeeId: who.cara, owedCents: 1_275_000, installmentCents: 75_000 },
    ];
    for (const ca of advances) {
      const { key, ...input } = ca;
      const r = await record('ca.opening', { ...input, note: 'Balance of the old cash advance sheet' }, ca.owedCents);
      opened[key] = r;
      expect(journalOf(r.id), key).toEqual([['1210', ca.employeeId, ca.owedCents, 0], ['3900', null, 0, ca.owedCents]]);
    }
    const owedByShop = await record('eq.opening', { personId: who.officerA, direction: 'shop_owes', amountCents: 12_000_000, note: 'Old officer ledger: advances to the shop' }, 12_000_000);
    const owedToShop = await record('eq.opening', { personId: who.officerB, direction: 'owes_shop', amountCents: 1_500_000, note: 'Old officer ledger: withdrawn by the officer' }, 1_500_000);
    expect(journalOf(owedByShop.id)).toEqual([['3900', null, 12_000_000, 0], ['2501', who.officerA, 0, 12_000_000]]);
    expect(journalOf(owedToShop.id)).toEqual([['1220', who.officerB, 1_500_000, 0], ['3900', null, 0, 1_500_000]]);
    expect(balances(env.db)['1210']).toBe(2_025_000);
  });

  it('the old equipment of 553,118.90, capitalised with its dates and lives', async () => {
    const docs = [];
    for (const input of assetInputs()) {
      const r = await record('fa.opening', input, input.costCents);
      docs.push(r);
      const acc = input.classCode === 'machinery' ? ['1510', '1511'] : ['1520', '1521'];
      expect(journalOf(r.id)).toEqual([
        [acc[0], r.id, input.costCents, 0], [acc[1], r.id, 0, input.accumulatedCents], ['3900', null, 0, input.costCents - input.accumulatedCents],
      ]);
      // On the straight line through September, the last month the old books charged: no warning.
      expect(r.warnings).toEqual([]);
    }
    [opened.faEmbroidery, opened.faSewing, opened.faComputers] = docs as [Recorded, Recorded, Recorded];
    expect(assetInputs().reduce((s, a) => s + a.costCents, 0)).toBe(55_311_890);
    expect(balances(env.db)['1510']).toBe(48_000_000);
    expect(balances(env.db)['1520']).toBe(7_311_890);
    expect(balances(env.db)['1511']).toBe(-15_480_000);
    expect(balances(env.db)['1521']).toBe(-3_200_000);
  });

  it('VAT and CWT carried over: the 2307s not yet used, one in hand and one still to come', async () => {
    const rows = [
      { customerId: c.school, year: 2026, quarter: 2, atc: 'WC158', cwtCents: 325_000, vatWithheldCents: 0, certificate: 'received' },
      { customerId: c.other, year: 2026, quarter: 3, atc: 'WC158', cwtCents: 120_000, vatWithheldCents: 0, certificate: 'pending' },
    ];
    const r = await record('tax.opening', { rows }, 445_000);
    opened.cwt = r;
    expect(journalOf(r.id)).toEqual([['1410', c.school, 325_000, 0], ['1410', c.other, 120_000, 0], ['3900', null, 0, 445_000]]);
  });

  it('is not closeable while 3900 has a balance: the checks say how much is missing', async () => {
    expect(sumCredit('3900')).toBe(112_642_880); // 1,126,428.80, worked in the header
    const s = await get(owner, '/api/acc/opening');
    expect(s.openingEquityCents).toBe(-112_642_880);
    expect(s.trialBalance).toMatchObject({ balanced: true });
    await stepUp(accountant);
    const r = await accountant.post('/api/acc/opening/close', {});
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({
      code: 'OPENING_EQUITY_NOT_ZERO',
      message: 'Opening balance equity still has a credit balance of ₱1,126,428.80. Record the equity breakdown until it is zero.',
    });
  });

  it('the equity breakdown (capital stock per stockholder, APIC, retained earnings) brings 3900 to exactly zero', async () => {
    const r = await record('acc.opening', {
      lines: [
        { accountId: id('3101'), stockholderId: who.officerA, creditCents: 30_000_000 },
        { accountId: id('3101'), stockholderId: who.officerB, creditCents: 20_000_000 },
        { accountId: id('3104'), creditCents: 10_000_000 },
        { accountId: id('3201'), creditCents: 52_642_880, memo: 'Retained earnings to the cut-over date' },
      ],
    }, 112_642_880);
    expect(journalOf(r.id)).toEqual([
      ['3101', who.officerA, 0, 30_000_000], ['3101', who.officerB, 0, 20_000_000], ['3104', null, 0, 10_000_000],
      ['3201', null, 0, 52_642_880], ['3900', null, 112_642_880, 0],
    ]);
    expect(balances(env.db)['3900']).toBeUndefined();
  });

  it('the opening trial balance balances at 2,674,255.40, line by line as worked by hand, and 3900 is zero', async () => {
    const tb = await get(owner, `/api/rpt/trial-balance?asOf=${CUTOVER}`);
    const rows = (tb.rows as { code: string; debitCents: number; creditCents: number }[]).map((r) => [r.code, r.debitCents, r.creditCents]);
    expect(rows).toEqual([
      ['1101', 9_968_000, 0], ['1102', 500_000, 0], ['1103', 1_250_000, 0], ['1111', 128_644_075, 0], ['1112', 21_000_000, 0], ['1121', 832_550, 0],
      ['1201', 3_750_000, 0], ['1210', 2_025_000, 0], ['1220', 1_500_000, 0], ['1301', 34_275_000, 0], ['1302', 4_860_000, 0],
      ['1402', 1_864_025, 0], ['1410', 445_000, 0], ['1420', 1_200_000, 0],
      ['1510', 48_000_000, 0], ['1511', 0, 15_480_000], ['1520', 7_311_890, 0], ['1521', 0, 3_200_000],
      ['2101', 0, 46_512_660], ['2201', 0, 3_700_000], ['2501', 0, 12_000_000], ['2601', 0, 73_890_000],
      ['3101', 0, 50_000_000], ['3104', 0, 10_000_000], ['3201', 0, 52_642_880],
    ]);
    expect([tb.totalDebitCents, tb.totalCreditCents]).toEqual([267_425_540, 267_425_540]);
    const s = await get(owner, '/api/acc/opening');
    expect(s.openingEquityCents).toBe(0);
    expect(s.trialBalance).toEqual({ asOf: CUTOVER, totalDebitCents: 267_425_540, totalCreditCents: 267_425_540, balanced: true });
    noBrokenInvariants();
  });

  it('every account kept per customer, supplier, employee, officer, loan or asset ties to its parties (D8 step 5)', async () => {
    const s = await get(owner, '/api/acc/opening');
    expect(s.checks.filter((x: { ok: boolean }) => !x.ok)).toEqual([]);
    const control = (code: string) => s.checks.find((x: { code: string }) => x.code === code);
    expect(control('1201')).toMatchObject({ controlCents: 3_750_000, partiesCents: 3_750_000 }); // opening AR subledger = AR control
    expect(control('2201')).toMatchObject({ controlCents: -3_700_000, partiesCents: -3_700_000 }); // deposits = 2201
    expect(control('2101')).toMatchObject({ controlCents: -46_512_660, partiesCents: -46_512_660 });
    expect(control('2601')).toMatchObject({ controlCents: -73_890_000, partiesCents: -73_890_000 });
    expect(control('1210')).toMatchObject({ controlCents: 2_025_000, partiesCents: 2_025_000 });
    expect(control('1510')).toMatchObject({ controlCents: 48_000_000, partiesCents: 48_000_000 });
    expect(control('1410')).toMatchObject({ controlCents: 445_000, partiesCents: 445_000 });
    expect(s.documents.map((d: { number: string }) => d.number)).toEqual([
      'OB-000001', 'OB-000002', 'OB-000003', 'OB-000004', 'OBAP-000001', 'OBAP-000002', 'OBAP-000003', 'OBCA-000001', 'OBCA-000002', 'OBCA-000003',
      'OBOF-000001', 'OBOF-000002', 'OBFA-000001', 'OBFA-000002', 'OBFA-000003', 'OBJO-000001', 'OBJO-000002', 'OBJO-000003', 'OBJO-000004',
      'OBLN-000001', 'OBLN-000002', 'OBWT-000001',
    ]);
  });

  it('the accountant signs off the opening: closed with a name and a time, and totals as worked', async () => {
    await stepUp(accountant);
    const r = await accountant.post('/api/acc/opening/close', {});
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().closed).toMatchObject({ cutoverDate: CUTOVER, totalDebitCents: 267_425_540, totalCreditCents: 267_425_540 });
    expect(r.json().closed.closedByName).toBeTruthy();
    expect(r.json().closed.closedAt.startsWith('2026-10-01')).toBe(true);
    noBrokenInvariants();
  });
});

describe('where staff will look for each open item (J4 step 3 results)', () => {
  it('the customer\'s balance: open items, statement of account and A/R aging show the opened receivables and deposits', async () => {
    const school = await get(encoder, `/api/col/customers/${c.school}/open-items`);
    expect(school.jobOrders).toEqual([
      { id: opened.jo1!.id, number: 'OBJO-000001', dueDate: '2026-10-05', totalCents: 5_600_000, balanceDueCents: 2_800_000, depositsHeldCents: 2_800_000 },
      { id: opened.jo3!.id, number: 'OBJO-000003', dueDate: '2026-10-05', totalCents: 1_500_000, balanceDueCents: 1_500_000, depositsHeldCents: 0 },
    ]);
    const other = await get(encoder, `/api/col/customers/${c.other}/open-items`);
    expect(other.jobOrders).toEqual([
      { id: opened.jo2!.id, number: 'OBJO-000002', dueDate: '2026-10-05', totalCents: 1_800_000, balanceDueCents: 900_000, depositsHeldCents: 900_000 },
      { id: opened.jo4!.id, number: 'OBJO-000004', dueDate: '2026-10-05', totalCents: 2_250_000, balanceDueCents: 2_250_000, depositsHeldCents: 0 },
    ]);

    const st = await get(accountant, `/api/rpt/customer-statement?customerId=${c.school}&from=${CUTOVER}&to=2026-10-31`);
    expect(st).toMatchObject({ openingBalanceCents: 0, closingBalanceCents: 1_500_000, openingDepositsHeldCents: 0, depositsHeldCents: 2_800_000 });
    expect(st.lines.map((l: { documentNumber: string; debitCents: number }) => [l.documentNumber, l.debitCents])).toEqual([['OBJO-000003', 1_500_000]]);
    expect(st.depositLines.map((l: { documentNumber: string; creditCents: number }) => [l.documentNumber, l.creditCents])).toEqual([['OBJO-000001', 2_800_000]]);
    const st2 = await get(accountant, `/api/rpt/customer-statement?customerId=${c.other}&from=${CUTOVER}&to=2026-10-31`);
    expect(st2).toMatchObject({ closingBalanceCents: 2_250_000, depositsHeldCents: 900_000 });

    const aging = await get(accountant, `/api/rpt/ar-aging?asOf=${CUTOVER}`);
    expect(aging.totalCents).toBe(3_750_000);
    expect(aging.rows.map((r: { customerName: string; documentNumber: string; totalCents: number }) => [r.customerName, r.documentNumber, r.totalCents])).toEqual([
      ['Moonlight Test School', 'OBJO-000003', 1_500_000], ['Paper Lantern Club', 'OBJO-000004', 2_250_000],
    ]);
    // The two orders not yet released are a memo (uninvoiced), outside the A/R total.
    expect(aging.memoTotalCents).toBe(7_400_000);
  });

  it('AP aging and each supplier\'s page show the opened bills, the overdue one in its bucket', async () => {
    const aging = await get(accountant, `/api/rpt/ap-aging?asOf=${CUTOVER}`);
    expect(aging.totalCents).toBe(46_512_660);
    expect(sorted(aging.rows.map((r: { number: string; supplierName: string; dueDate: string; balanceCents: number; bucket: string }) => [r.number, r.supplierName, r.dueDate, r.balanceCents, r.bucket]))).toEqual(
      sorted([
        ['OBAP-000001', 'Sample Equipment Supply', '2026-10-15', 38_451_110, 'current'],
        ['OBAP-000002', 'Sample Fabric House', '2026-09-25', 6_234_000, 'days1to30'],
        ['OBAP-000003', 'Sample Thread Co', '2026-10-22', 1_827_550, 'current'],
      ]),
    );
    const page = await get(accountant, `/api/ap/suppliers/${who.equipment}`);
    expect(page).toMatchObject({ supplierName: 'Sample Equipment Supply', balanceCents: 38_451_110 });
    expect(page.bills).toMatchObject([{ number: 'OBAP-000001', docType: 'ap.opening', supplierInvoiceNo: 'SI-2211', payableCents: 38_451_110, owedCents: 38_451_110, paidCents: 0 }]);
    const list = await get(accountant, '/api/ap/suppliers');
    expect(list.reduce((s: number, x: { balanceCents: number }) => s + x.balanceCents, 0)).toBe(46_512_660);
  });

  it('the loan ledger shows both loans with what was received, what is owed and the next instalment', async () => {
    const loans = await get(accountant, '/api/loan/loans');
    expect(loans.map((l: { number: string; lender: string; principalCents: number; owedAtCutoverCents: number; balanceCents: number; instalments: number }) =>
      [l.number, l.lender, l.principalCents, l.owedAtCutoverCents, l.balanceCents, l.instalments])).toEqual([
      ['OBLN-000002', 'Sample Investor B', 30_000_000, 23_890_000, 23_890_000, 13], // newest first
      ['OBLN-000001', 'Sample Investor A', 60_000_000, 50_000_000, 50_000_000, 13],
    ]);
    const a = await get(accountant, `/api/loan/loans/${opened.loanA!.id}`);
    // Instalment 1 by hand: interest 500,000.00 × 12% ÷ 12 = 5,000.00; level payment 41,207.41, so principal 36,207.41.
    expect(a.nextDue).toEqual({ instalmentNo: 1, dueDate: '2026-10-15', principalCents: 3_620_741, interestCents: 500_000 });
    expect(a.schedule).toHaveLength(13);
    expect(a.schedule.reduce((s: number, r: { principalCents: number }) => s + r.principalCents, 0)).toBe(50_000_000);
    const level = Math.round((50_000_000 * 0.01) / (1 - 1.01 ** -13));
    expect(level).toBe(4_120_741);
  });

  it('the asset register lists each old asset with its dates, life and book value; charges start with the cut-over month', async () => {
    const register = await get(accountant, '/api/fa/assets');
    expect(register.map((a: Record<string, unknown>) => [a.number, a.description, a.acquiredOn, a.costCents, a.lifeMonths, a.openedOn, a.accumulatedCents, a.bookValueCents, a.monthlyChargeCents])).toEqual([
      ['OBFA-000001', 'Embroidery machine', '2024-11-05', 30_000_000, 60, CUTOVER, 10_350_000, 19_650_000, 450_000],
      ['OBFA-000002', 'Sewing machines and cutting table', '2025-03-10', 18_000_000, 60, CUTOVER, 5_130_000, 12_870_000, 270_000],
      ['OBFA-000003', 'Office computers and printer', '2025-06-20', 7_311_890, 36, CUTOVER, 3_200_000, 4_111_890, 200_000],
    ]);
    expect(register.reduce((s: number, a: { costCents: number }) => s + a.costCents, 0)).toBe(55_311_890);
  });

  it('the cash book of each cash place opens with the counted or statement balance', async () => {
    const opening: [string, number][] = [['1101', 9_968_000], ['1102', 500_000], ['1103', 1_250_000], ['1111', 128_644_075], ['1112', 21_000_000], ['1121', 832_550]];
    for (const [code, cents] of opening) {
      const book = await get(accountant, `/api/cash/places/${id(code)}/book?from=${CUTOVER}&to=2026-10-31`);
      expect(book.openingCents, code).toBe(0);
      expect(book.lines.map((l: { documentNumber: string; inCents: number; outCents: number; balanceCents: number }) => [l.documentNumber, l.inCents, l.outCents, l.balanceCents]), code).toEqual([['OB-000001', cents, 0, cents]]);
      expect(book.closingCents, code).toBe(cents);
    }
  });

  it('cash advances per employee, officer balances and the 2307s are in the registers staff use', async () => {
    for (const [emp, cents, instalment] of [[who.ana, 200_000, 100_000], [who.ben, 550_000, 50_000], [who.cara, 1_275_000, 75_000]] as const) {
      const page = await get(accountant, `/api/ca/employees/${emp}`);
      expect(page).toMatchObject({ outstandingCents: cents, installmentCents: instalment });
    }
    const officers = await get(accountant, '/api/eq/balances');
    expect(sorted(officers.map((o: { personId?: string; id?: string; dueFromCents: number; dueToCents: number }) => [o.personId ?? o.id, o.dueFromCents, o.dueToCents]))).toEqual(
      sorted([[who.officerA, 0, 12_000_000], [who.officerB, 1_500_000, 0]]),
    );
    const reg = await get(accountant, '/api/tax/registers/withholding-received?from=2026-07-01&to=2026-12-31');
    expect(reg.rows.map((r: { documentNumber: string; cwtCents: number; certificate: string; opening: boolean }) => [r.documentNumber, r.cwtCents, r.certificate, r.opening]).sort()).toEqual([
      ['OBWT-000001', 120_000, 'pending', true], ['OBWT-000001', 325_000, 'received', true],
    ]);
  });
});

describe('first day on top of the opened books, 2026-10-02 (J4 step 6)', () => {
  let cr = 600;
  const collect = async (customerId: string, jobOrderId: string, cents: number, cashPlace: string) => {
    const input = { customerId, crNumber: String(++cr), applications: [{ jobOrderId, amountCents: cents }], tenders: [{ cashPlaceId: id(cashPlace), amountCents: cents }] };
    const r = await encoder.post('/api/docs/col.collection/post', { input, expectedTotalCents: cents }, idem());
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Recorded;
  };
  const statusOf = async (jobOrderId: string) => get(encoder, `/api/jo/orders/${jobOrderId}/status`);

  it('the morning cash count agrees with the opened books: nothing to post', async () => {
    await goTo('2026-10-02T02:00:00Z');
    const r = await accountant.post('/api/docs/cash.count/post', { input: { cashPlaceId: id('1101'), lines: COUNT_SHEET }, expectedTotalCents: COUNTED_CASH }, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ number: 'CNT-000001', businessDate: '2026-10-02', journalNumber: null });
    expect(journalOf(r.json().id)).toEqual([]);
  });

  it('a collection on an opened job order pays the opened receivable, then a part payment by GCash on another', async () => {
    const cash = await collect(c.school, opened.jo3!.id, 1_500_000, '1101');
    expect(cash).toMatchObject({ businessDate: '2026-10-02' });
    expect(journalOf(cash.id)).toEqual([['1101', null, 1_500_000, 0], ['1201', c.school, 0, 1_500_000]]);
    expect(journalDates(cash.id)).toEqual(['2026-10-02']);
    expect((await statusOf(opened.jo3!.id)).money).toMatchObject({ receivableCents: 0, balanceDueCents: 0, collectedCents: 1_500_000 });

    const gcash = await collect(c.other, opened.jo4!.id, 1_000_000, '1121');
    expect(journalOf(gcash.id)).toEqual([['1121', null, 1_000_000, 0], ['1201', c.other, 0, 1_000_000]]);
    expect((await statusOf(opened.jo4!.id)).money).toMatchObject({ receivableCents: 1_250_000, balanceDueCents: 1_250_000 });
    const open = await get(encoder, `/api/col/customers/${c.other}/open-items`);
    expect(open.jobOrders.find((j: { id: string }) => j.id === opened.jo4!.id)).toMatchObject({ balanceDueCents: 1_250_000 });
  });

  it('a live production order re-created from the old sheet gets its remaining steps and shows on the board (J4 step 4)', async () => {
    const production = await env.as('production');
    const setup = await production.post(`/api/prd/jobs/${opened.jo2!.id}/lines/1/setup`, { templateId: 1, stepIds: [4, 6, 8], garmentType: 'T-shirt', complexity: 'standard' });
    expect(setup.statusCode, setup.body).toBe(200);
    const board = await get(encoder, '/api/prd/board');
    expect(board.filter((b: { jobOrderId: string }) => b.jobOrderId === opened.jo2!.id)).toMatchObject([{ number: 'OBJO-000002', stage: 'open', lineNo: 1, qty: 12 }]);
    expect(board.filter((b: { jobOrderId: string }) => b.jobOrderId === opened.jo1!.id)).toMatchObject([{ number: 'OBJO-000001', qty: 20 }]);
  });

  it('a release that uses its opened deposit: the invoice takes 28,000.00 of 2201 and leaves 28,000.00 to collect', async () => {
    const jo = opened.jo1!.id;
    for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) expect((await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to })).statusCode).toBe(200);
    const rel = await accountant.post('/api/jo/releases', {
      release: { jobOrderId: jo, lines: [{ lineNo: 1, qty: 20 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer after the event', creditDueInDays: 7 },
      invoice: { invoiceNumber: '0701' },
      expectedTotalCents: 5_600_000,
    }, idem());
    expect(rel.statusCode, rel.body).toBe(200);
    const ir = rel.json().invoiceRecord as Recorded;
    expect(ir.summary).toBe(
      'This will record invoice no. 0701 to Moonlight Test School for REL-000001 of OBJO-000001: ₱56,000.00 (VATable sales ₱50,000.00, VAT ₱6,000.00). ₱28,000.00 of deposits is applied; ₱28,000.00 is left to collect.',
    );
    expect(journalOf(ir.id)).toEqual([
      ['1201', c.school, 5_600_000, 0], ['4101', c.school, 0, 5_000_000], ['2301', c.school, 0, 600_000],
      ['2201', c.school, 2_800_000, 0], ['1201', c.school, 0, 2_800_000],
    ]);
    expect(journalDates(ir.id)).toEqual(['2026-10-02']);
    expect((await statusOf(jo)).money).toMatchObject({ totalCents: 5_600_000, invoicedCents: 5_600_000, depositsHeldCents: 0, receivableCents: 2_800_000, balanceDueCents: 2_800_000 });
    // The school's page: the opened 15,000.00 is paid, the released order owes 28,000.00 and no deposit is held.
    const st = await get(accountant, `/api/rpt/customer-statement?customerId=${c.school}&from=${CUTOVER}&to=2026-10-31`);
    expect(st).toMatchObject({ closingBalanceCents: 2_800_000, depositsHeldCents: 0 });
  });

  it('a payment on an opened bill: part of the equipment payable, and the thread bill in full, from BDO', async () => {
    const pay = (supplierId: string, billId: string, cents: number) =>
      encoder.post('/api/docs/ap.payment/post', { input: { supplierId, bills: [{ billId, amountCents: cents }], tenders: [{ cashPlaceId: id('1111'), amountCents: cents }] }, expectedTotalCents: cents }, idem());
    const part = await pay(who.equipment, opened.billEquipment!.id, 10_000_000);
    expect(part.statusCode, part.body).toBe(200);
    expect(part.json().summary).toBe('This will record paying Sample Equipment Supply ₱100,000.00 on OBAP-000001: ₱100,000.00 from Cash in bank – BDO.');
    expect(journalOf(part.json().id)).toEqual([['2101', who.equipment, 10_000_000, 0], ['1111', null, 0, 10_000_000]]);
    const over = await pay(who.equipment, opened.billEquipment!.id, 28_451_111);
    expect(over.json()).toMatchObject({ code: 'VALIDATION', message: 'Only ₱284,511.10 is still owed on OBAP-000001.' });
    const full = await pay(who.thread, opened.billThread!.id, 1_827_550);
    expect(journalOf(full.json().id)).toEqual([['2101', who.thread, 1_827_550, 0], ['1111', null, 0, 1_827_550]]);

    const aging = await get(accountant, '/api/rpt/ap-aging?asOf=2026-10-02');
    expect(aging.totalCents).toBe(34_685_110); // 384,511.10 − 100,000.00 + 62,340.00
    expect(aging.rows.map((r: { number: string }) => r.number).sort()).toEqual(['OBAP-000001', 'OBAP-000002']);
    expect((await get(accountant, `/api/ap/suppliers/${who.equipment}`)).bills[0]).toMatchObject({ owedCents: 28_451_110, paidCents: 10_000_000 });
  });

  it('a loan repayment: instalment 1 of the 500,000.00 loan splits 36,207.41 principal and 5,000.00 interest', async () => {
    const r = await encoder.post('/api/docs/loan.payment/post', { input: { loanId: opened.loanA!.id, instalmentNo: 1, cashPlaceId: id('1111') }, expectedTotalCents: 4_120_741 }, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(journalOf(r.json().id)).toEqual([['2601', opened.loanA!.id, 3_620_741, 0], ['7201', null, 500_000, 0], ['1111', null, 0, 4_120_741]]);
    const ledger = await get(accountant, `/api/loan/loans/${opened.loanA!.id}`);
    expect(ledger).toMatchObject({ balanceCents: 46_379_259, principalPaidCents: 13_620_741, interestPaidCents: 500_000 });
    expect(ledger.nextDue).toMatchObject({ instalmentNo: 2, dueDate: '2026-11-15', principalCents: 3_656_948, interestCents: 463_793 });
    // Loan B is untouched.
    expect(await get(accountant, `/api/loan/loans/${opened.loanB!.id}`)).toMatchObject({ balanceCents: 23_890_000 });
  });

  it('the end-of-day cash count: 50.00 short of the 114,680.00 in the books posts to cash short and over', async () => {
    const lines = [{ denominationCents: 100_000, qty: 100 }, { denominationCents: 50_000, qty: 29 }, { denominationCents: 10_000, qty: 1 }, { denominationCents: 2_000, qty: 1 }, { denominationCents: 1_000, qty: 1 }];
    const pre = await accountant.post('/api/docs/cash.count/preview', { input: { cashPlaceId: id('1101'), lines } });
    expect(pre.json()).toMatchObject({ totalCents: 11_463_000 });
    const r = await accountant.post('/api/docs/cash.count/post', { input: { cashPlaceId: id('1101'), lines }, expectedTotalCents: 11_463_000 }, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(journalOf(r.json().id)).toEqual([['6280', null, 5_000, 0], ['1101', null, 0, 5_000]]);
    const book = await get(accountant, `/api/cash/places/${id('1101')}/book?from=2026-10-02&to=2026-10-02`);
    expect(book.openingCents).toBe(9_968_000);
    expect(book.closingCents).toBe(11_463_000); // 99,680.00 + 15,000.00 − 50.00 = 114,630.00
  });

  it('the books at the end of the day are the opening plus these documents, every journal balances, and 3900 is still zero', async () => {
    expect(balances(env.db)).toEqual({
      '1101': 11_463_000, '1102': 500_000, '1103': 1_250_000, '1111': 112_695_784, '1112': 21_000_000, '1121': 1_832_550,
      '1201': 4_050_000, '1210': 2_025_000, '1220': 1_500_000, '1301': 34_275_000, '1302': 4_860_000, '1402': 1_864_025, '1410': 445_000, '1420': 1_200_000,
      '1510': 48_000_000, '1511': -15_480_000, '1520': 7_311_890, '1521': -3_200_000,
      '2101': -34_685_110, '2201': -900_000, '2301': -600_000, '2501': -12_000_000, '2601': -70_269_259,
      '3101': -50_000_000, '3104': -10_000_000, '3201': -52_642_880, '4101': -5_000_000, '6280': 5_000, '7201': 500_000,
    });
    const tb = await get(owner, '/api/rpt/trial-balance?asOf=2026-10-02');
    expect(tb.totalDebitCents).toBe(tb.totalCreditCents);
    expect((await get(owner, '/api/acc/opening')).openingEquityCents).toBe(0);
    noBrokenInvariants();
  });
});

describe('the first month end: inventory count and the first depreciation run', () => {
  it('October\'s count of materials and ready-made goods adjusts the opened inventory, both directions', async () => {
    await goTo('2026-10-31T02:00:00Z');
    const supply = async (name: string, unit: string, category: string, lastCostCents: number) => {
      const s = (await accountant.post('/api/pur/supplies', { name, unit, category })).json().id as string;
      env.db.prepare('UPDATE pur_supplies SET last_purchase_cost_cents = ? WHERE id = ?').run(lastCostCents, s);
      return s;
    };
    const twill = await supply('Cotton twill', 'yard', 'materials', 12_000);
    const thread = await supply('Thread cone', 'pc', 'materials', 5_000);
    const polo = await supply('Polo shirt, ready-made', 'pc', 'ready_made', 35_000);
    const count = async (input: object, cents: number) => {
      const r = await accountant.post('/api/docs/inv.count/post', { input, expectedTotalCents: cents }, idem());
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as Recorded;
    };
    const materials = await count({ category: 'materials', lines: [{ supplyId: twill, qty: 2_500_000 }, { supplyId: thread, qty: 900 }] }, 34_500_000);
    expect(materials.summary).toBe('This will record materials and supplies counted at ₱345,000.00 on 2026-10-31 against ₱342,750.00 in the books: ₱2,250.00 more, posted to inventory change.');
    expect(journalOf(materials.id)).toEqual([['1301', null, 225_000, 0], ['5109', null, 0, 225_000]]);
    const ready = await count({ category: 'ready_made', lines: [{ supplyId: polo, qty: 138 }] }, 4_830_000);
    expect(ready.summary).toBe('This will record ready-made merchandise counted at ₱48,300.00 on 2026-10-31 against ₱48,600.00 in the books: ₱300.00 less, posted to inventory change.');
    expect(journalOf(ready.id)).toEqual([['5109', null, 30_000, 0], ['1302', null, 0, 30_000]]);
    expect([balances(env.db)['1301'], balances(env.db)['1302']]).toEqual([34_500_000, 4_830_000]);
    noBrokenInvariants();
  });

  /**
   * The old books were on the straight line through 30 September (the accumulated figures typed at the opening are exactly
   * that), so October's own charge is owed on 31 October: 4,500.00 on the embroidery machine ((300,000 − 30,000) ÷ 60),
   * 2,700.00 on the sewing machines ((180,000 − 18,000) ÷ 60) and 2,000.00 on the computers ((73,118.90 − 1,118.90) ÷ 36)
   * = 9,200.00. (Found by this test when the app took the cut-over month as charged by the old books; fixed in FA assets.ts
   * lastMonthCharged.)
   */
  it('October, the cut-over month, charges 9,200.00 on the straight line when the old books stopped at 30 September', async () => {
    const r = await accountant.post('/api/docs/fa.depreciation/post', { input: { month: '2026-10' }, expectedTotalCents: 920_000 }, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(sorted(journalOf(r.json().id))).toEqual(
      sorted([
        ['5302', null, 450_000, 0], ['1511', opened.faEmbroidery!.id, 0, 450_000],
        ['5302', null, 270_000, 0], ['1511', opened.faSewing!.id, 0, 270_000],
        ['6210', null, 200_000, 0], ['1521', opened.faComputers!.id, 0, 200_000],
      ]),
    );
  });

  it('the second depreciation run (November) goes on along the straight line, to the centavo', async () => {
    await goTo('2026-11-30T02:00:00Z');
    const pre = await accountant.post('/api/docs/fa.depreciation/preview', { input: { month: '2026-11' } });
    expect(pre.json()).toMatchObject({ totalCents: 920_000, summary: 'This will charge ₱9,200.00 depreciation for November 2026 on 3 assets.' });
    const r = await accountant.post('/api/docs/fa.depreciation/post', { input: { month: '2026-11' }, expectedTotalCents: 920_000 }, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ number: 'DEPR-000002', businessDate: '2026-11-30' });
    expect(sorted(journalOf(r.json().id))).toEqual(
      sorted([
        ['5302', null, 450_000, 0], ['1511', opened.faEmbroidery!.id, 0, 450_000],
        ['5302', null, 270_000, 0], ['1511', opened.faSewing!.id, 0, 270_000],
        ['6210', null, 200_000, 0], ['1521', opened.faComputers!.id, 0, 200_000],
      ]),
    );
    expect(journalDates(r.json().id)).toEqual(['2026-11-30']);
    const register = await get(accountant, '/api/fa/assets');
    expect(register.map((a: { accumulatedCents: number; bookValueCents: number }) => [a.accumulatedCents, a.bookValueCents])).toEqual([
      [11_250_000, 18_750_000], [5_670_000, 12_330_000], [3_600_000, 3_711_890],
    ]);
    const again = await accountant.post('/api/docs/fa.depreciation/preview', { input: { month: '2026-11' } });
    expect(again.json().issues.map((i: { code: string }) => i.code)).toEqual(['ALREADY_RUN']); // one run a month
  });

  it('after a month of work: 3900 is zero, the opening stays closed, every journal balances and every invariant holds', async () => {
    expect(balances(env.db)['3900']).toBeUndefined();
    const tb = await get(owner, '/api/rpt/trial-balance?asOf=2026-11-30');
    expect(tb.totalDebitCents).toBe(tb.totalCreditCents);
    expect(tb.rows.find((r: { code: string }) => r.code === '3900')).toBeUndefined();
    expect((await get(owner, '/api/acc/opening')).closed).toMatchObject({ cutoverDate: CUTOVER });
    noBrokenInvariants();
  });
});

describe('recording the opening twice (D8: the wizard will not close until 3900 = 0)', () => {
  const cashLines = () => [{ accountId: id('1101'), debitCents: COUNTED_CASH }, { accountId: id('1111'), debitCents: 128_644_075 }];
  const post = (type: string, input: object, total: number, headers: Record<string, string> = idem()) =>
    accountant.post(`/api/docs/${type}/post`, { input, expectedTotalCents: total, businessDate: CUTOVER }, headers);
  const documents = (type: string) => env.db.prepare(`SELECT number FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];
  const closeIt = async () => (await stepUp(accountant), accountant.post('/api/acc/opening/close', {}));
  const equityCents = async () => (await get(owner, '/api/acc/opening')).openingEquityCents as number;

  beforeAll(async () => {
    await newShop();
    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/cutover-date', { date: CUTOVER })).statusCode).toBe(200);
  });

  it('the same request sent again (a double click or a retry) returns the first document and posts nothing more', async () => {
    const headers = idem();
    const first = await post('acc.opening', { lines: cashLines() }, 138_612_075, headers);
    expect(first.statusCode, first.body).toBe(200);
    const again = await post('acc.opening', { lines: cashLines() }, 138_612_075, headers);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ id: first.json().id, number: 'OB-000001' });
    expect(documents('acc.opening')).toEqual(['OB-000001']);
    expect(balances(env.db)).toEqual({ '1101': 9_968_000, '1111': 128_644_075, '3900': -138_612_075 });
  });

  it('the same balances typed again as a new document are recorded a second time: cash doubles and 3900 shows it', async () => {
    const dup = await post('acc.opening', { lines: cashLines() }, 138_612_075);
    expect(dup.statusCode, dup.body).toBe(200);
    expect(dup.json().number).toBe('OB-000002');
    expect(balances(env.db)).toEqual({ '1101': 19_936_000, '1111': 257_288_150, '3900': -277_224_150 });
    expect(await equityCents()).toBe(-277_224_150);
    opened.dupCash = dup.json();
  });

  it('a job order, a supplier bill or a statutory month typed twice is refused by number; a loan, asset, advance, officer or 2307 is not', async () => {
    const jo = joInput({ customerId: c.school, oldNumber: 'JO 1150', receivableCents: 1_500_000, oldInvoices: '0412, 0413' });
    opened.jo = await record('jo.opening', jo, 1_500_000);
    expect(await issueCodes('jo.opening', jo)).toEqual(['OLD_NUMBER_USED']);
    const bill = { supplierId: who.equipment, supplierInvoiceNo: 'SI-2211', supplierInvoiceDate: '2026-03-15', dueDate: '2026-10-15', owedCents: 38_451_110 };
    opened.bill = await record('ap.opening', bill, 38_451_110);
    expect(await issueCodes('ap.opening', bill)).toEqual(['DUPLICATE_INVOICE']);

    const loan = { lender: 'Sample Investor A', kind: 'loan', originalPrincipalCents: 60_000_000, dateReceived: '2025-11-10', principalCents: 50_000_000, interestRateBp: 1200, monthsLeft: 13, schedule: 'declining', nextDueDate: '2026-10-15', reference: 'PN 2025-011' };
    const advance = { employeeId: who.ana, owedCents: 200_000, installmentCents: 100_000, note: 'Balance of the old cash advance sheet' };
    const officer = { personId: who.officerB, direction: 'owes_shop', amountCents: 1_500_000, note: 'Old officer ledger: withdrawn by the officer' };
    const twoSevens = { rows: [{ customerId: c.school, year: 2026, quarter: 2, atc: 'WC158', cwtCents: 325_000, vatWithheldCents: 0, certificate: 'received' }] };
    const asset = assetInputs()[0]!;
    const unguarded: [string, object, number][] = [
      ['loan.opening', loan, 50_000_000], ['ca.opening', advance, 200_000], ['eq.opening', officer, 1_500_000], ['tax.opening', twoSevens, 325_000], ['fa.opening', asset, asset.costCents],
    ];
    for (const [type, input, total] of unguarded) {
      expect(await issueCodes(type, input), type).toEqual([]);
      const first = await record(type, input, total);
      const second = await record(type, input, total);
      expect([type, first.number === second.number], type).toEqual([type, false]);
      opened[`${type}#2`] = second;
    }
    expect(balances(env.db)['2601']).toBe(-100_000_000);
    expect(balances(env.db)['1210']).toBe(400_000);
    expect(balances(env.db)['1220']).toBe(3_000_000);
    expect(balances(env.db)['1410']).toBe(650_000);
    expect(balances(env.db)['1510']).toBe(60_000_000);
  });

  it('the close is refused while the doubles stand, whatever is typed for equity: 3900 is the safety net', async () => {
    const r = await closeIt();
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('OPENING_EQUITY_NOT_ZERO');
    expect(r.json().message).toMatch(/^Opening balance equity still has a (credit|debit) balance of ₱[\d,]+\.\d\d\. Record the equity breakdown until it is zero\.$/);
    // The 2307s of the same customer are one party on 1410, so control and parties still tie; only 3900 gives the double away.
    expect((await get(owner, '/api/acc/opening')).checks.filter((x: { ok: boolean }) => !x.ok)).toEqual([]);
  });

  it('cancelling the doubles on the cut-over date takes them back exactly; only the first of each stays', async () => {
    const doubles = [opened.dupCash!, ...Object.entries(opened).filter(([k]) => k.endsWith('#2')).map(([, v]) => v)];
    for (const d of doubles) {
      const type = (env.db.prepare('SELECT doc_type FROM documents WHERE id = ?').pluck().get(d.id) as string);
      const r = await accountant.post(`/api/docs/${type}/${d.id}/cancel`, { reason: 'Typed twice by mistake at cut-over' }, idem());
      expect(r.statusCode, `${type} ${r.body}`).toBe(200);
      expect(journalDates(d.id), type).toEqual([CUTOVER]);
    }
    expect(balances(env.db)).toEqual({
      '1101': 9_968_000, '1111': 128_644_075, '1201': 1_500_000, '1210': 200_000, '1220': 1_500_000, '1410': 325_000, '1510': 30_000_000, '1511': -10_350_000,
      '2101': -38_451_110, '2601': -50_000_000, '3900': -73_335_965,
    });
    noBrokenInvariants();
  });

  it('the equity breakdown typed for what is really there brings 3900 to zero, and the opening closes', async () => {
    // What is left, worked by hand: debits 99,680.00 + 1,286,440.75 + 15,000.00 + 2,000.00 + 15,000.00 + 3,250.00 + 300,000.00 = 1,721,370.75,
    // credits 103,500.00 + 384,511.10 + 500,000.00 = 988,011.10; the difference, 733,359.65, is what equity must be.
    expect(await equityCents()).toBe(-73_335_965);
    const eq = await post('acc.opening', {
      lines: [{ accountId: id('3101'), stockholderId: who.officerA, creditCents: 50_000_000 }, { accountId: id('3201'), creditCents: 23_335_965 }],
    }, 73_335_965);
    expect(eq.statusCode, eq.body).toBe(200);
    expect(await equityCents()).toBe(0);
    const closed = await closeIt();
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().closed).toMatchObject({ cutoverDate: CUTOVER });
    noBrokenInvariants();
  });

  it('once closed, a second opening of any kind is refused, nothing can be cancelled and the date cannot move', async () => {
    const late = await accountant.post('/api/docs/acc.opening/preview', { input: { lines: cashLines() }, businessDate: CUTOVER });
    expect(late.json().issues.map((i: { code: string }) => i.code)).toEqual(['OPENING_CLOSED']);
    expect(await issueCodes('loan.opening', { lender: 'Sample Investor C', kind: 'loan', originalPrincipalCents: 1_000_000, dateReceived: '2025-11-10', principalCents: 500_000, interestRateBp: 1200, monthsLeft: 5, schedule: 'declining', nextDueDate: '2026-10-15' })).toEqual(['OPENING_CLOSED']);
    const cancel = await accountant.post(`/api/docs/jo.opening/${opened.jo!.id}/cancel`, { reason: 'Old job order was already paid in full' }, idem());
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().code).toBe('OPENING_CLOSED');
    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/cutover-date', { date: '2026-09-30' })).json().code).toBe('OPENING_CLOSED');
    expect((await accountant.post('/api/acc/opening/close', {})).json().code).toBe('OPENING_CLOSED');
    expect(documents('acc.opening')).toEqual(['OB-000001', 'OB-000003']); // OB-000002 was the double, cancelled before the close
  });
});
