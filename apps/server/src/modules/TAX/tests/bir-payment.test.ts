/**
 * BIR payments (BIRP-, PLAN D5 VAT-PAY and EWT-REM) and the 0619-E and 1601-EQ worksheets. Q3 2026 with made-up
 * payees: a lessor (rent 5%), a printer (contractor 2%), an audit firm (10%) and a one-off consultant (5%). July's
 * 0619-E is paid in full (backdated to the day paid), August's in part with a penalty, September has no 0619-E, and
 * the 1601-EQ pays the rest per payee; the EWT register and the 2307s to issue do not move when EWT is paid. The 2550Q
 * pays the VAT close in two parts, the second late with a penalty. Goldens, cancels and runInvariants.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { formatPesos } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import type { BirPaymentInput } from '../doctypes/bir-payment.ts';

let env: TestEnv;
let encoder: Client, accountant: Client, owner: Client;
let BDO: number;
let printer: string, lessor: string, auditor: string;

const CONSULTANT = 'tin:777888999000';
const cat = (code: string) => env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;
const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const balance = (code: string) =>
  env.db.prepare('SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ?').pluck().get(code) as number;
const posted = (res: { statusCode: number; body: string; json(): { id: string } }) => (expect(res.statusCode, res.body).toBe(200), res.json().id);
const newSupplier = async (s: Record<string, unknown>) => (await accountant.post('/api/pur/suppliers', { isVatRegistered: true, ...s })).json().id as string;
const bill = async (supplierId: string, supplierInvoiceNo: string, supplierInvoiceDate: string, lines: { amountCents: number; [k: string]: unknown }[]) =>
  posted(await encoder.post('/api/docs/ap.bill/post', { input: { supplierId, supplierInvoiceNo, supplierInvoiceDate, lines }, expectedTotalCents: lines.reduce((s, l) => s + l.amountCents, 0) }, idem()));
const voucher = async (input: { amountCents: number; [k: string]: unknown }) => {
  // Paid from BDO: what leaves it is the receipt less any EWT, which the server works out (preview).
  const base = { ...input, tenders: [{ cashPlaceId: BDO, amountCents: 1 }] };
  const cash = (await accountant.post('/api/docs/exp.voucher/preview', { input: base })).json().doc.cashCents as number;
  return posted(await accountant.post('/api/docs/exp.voucher/post', { input: { ...input, tenders: [{ cashPlaceId: BDO, amountCents: cash }] }, expectedTotalCents: input.amountCents }, idem()));
};
const rent = (day: string) => voucher({ supplierId: lessor, categoryId: cat('6110'), amountCents: 4_000_000, description: `Rent paid ${day}`, supplierInvoiceNo: `OR-${day}`, supplierInvoiceDate: day });
/** Moves the clock; yesterday's sessions have timed out. */
const goTo = async (date: string) => {
  env.clock.set(`${date}T02:00:00Z`);
  [encoder, accountant, owner] = [await env.as('encoder'), await env.as('accountant'), await env.as('owner')];
};

const pay = (o: Partial<BirPaymentInput> & Pick<BirPaymentInput, 'form' | 'period' | 'amountCents'>): BirPaymentInput => ({ cashPlaceId: BDO, reference: 'eFPS 0001', ...o });
const preview = async (input: BirPaymentInput, who = accountant, businessDate?: string) =>
  (await who.post('/api/docs/tax.bir_payment/preview', { input, ...(businessDate ? { businessDate } : {}) })).json();
const record = async (input: BirPaymentInput, who = accountant, businessDate?: string) => {
  const res = await who.post('/api/docs/tax.bir_payment/post', { input, expectedTotalCents: (await preview(input, who, businessDate)).totalCents, ...(businessDate ? { businessDate } : {}) }, idem());
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; number: string; businessDate: string; totalCents: number; warnings: { code: string; level: string }[] };
};
const codes = (issues: { code: string; level: string }[], level = 'error') => issues.filter((i) => i.level === level).map((i) => i.code);
const cancel = (id: string, type = 'tax.bir_payment') => accountant.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded against the wrong return' }, idem());

/** The document's journal: "2311 Dr 1,785.71 Sample Lessor Corp.", by account and payee. */
function journal(documentId: string, kind: 'original' | 'reversal' = 'original'): string[] {
  const rows = env.db
    .prepare(
      `SELECT a.code, l.debit_cents AS dr, l.credit_cents AS cr, COALESCE(s.registered_name, l.party_id) AS party FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id LEFT JOIN pur_suppliers s ON s.id = l.party_id
       WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY a.code, party`,
    )
    .all(documentId, kind) as { code: string; dr: number; cr: number; party: string | null }[];
  return rows.map((r) => `${r.code} ${r.dr ? 'Dr' : 'Cr'} ${formatPesos(r.dr || r.cr)}${r.party ? ` ${r.party}` : ''}`);
}
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

describe('EWT: 0619-E for months 1 and 2, the 1601-EQ for the quarter (D5 EWT-REM)', () => {
  beforeEach(async () => {
    env = await createTestEnv('2026-07-15T02:00:00Z'); encoderOwnDefaults(env);
    await goTo('2026-07-15');
    BDO = cashPlaceId(env.db, '1111');
    printer = await newSupplier({ name: 'Sample Print', registeredName: 'Sample Print Shop Co.', tin: '222-333-444-000', ewtClass: 'contractor_2' });
    lessor = await newSupplier({ name: 'Sample Lessor', registeredName: 'Sample Lessor Corp.', tin: '333-444-555-000', ewtClass: 'rent_5' });
    auditor = await newSupplier({ name: 'Sample Audit', registeredName: 'Sample Audit Firm', tin: '555-666-777-000', ewtClass: 'prof_firm_10' });
    // July: rent 1,785.71; printing 120.00 (2% of 6,000.00); a one-off consultant 500.00 (5% of 10,000.00).
    await rent('2026-07-15');
    await bill(printer, 'SI-0042', '2026-07-14', [{ purchase: 'freight_in', amountCents: 112_000 }, { purchase: 'subcontract', amountCents: 560_000 }]);
    await voucher({ categoryId: cat('6190'), amountCents: 1_000_000, description: 'Pattern consultation', payeeName: 'Juan Sample', payeeVatRegistered: false,
      payeeTin: '777-888-999-000', ewtClass: 'prof_ind_5' });
  });

  it('pays each month and the quarter per payee; partial, penalty, overpayment, third month and backdating; cancel mirrors', async () => {
    await goTo('2026-08-12');
    const july = pay({ form: '0619-E', period: '2026-07', amountCents: 240_571, reference: 'eFPS 0810-0001' });
    const pre = await preview(july);
    expect([codes(pre.issues), codes(pre.issues, 'warning'), pre.totalCents]).toEqual([[], ['LATE'], 240_571]); // due 2026-08-10, recorded 08-12
    expect(pre.summary).toBe('This will record ₱2,405.71 EWT paid to the BIR with the 0619-E for July 2026 (eFPS 0810-0001) from Cash in bank – BDO, for 3 payees.');
    // Paid on the 10th, recorded on the 12th: the accountant dates it the day paid; an owner may not backdate.
    expect((await owner.post('/api/docs/tax.bir_payment/post', { input: july, expectedTotalCents: 240_571, businessDate: '2026-08-10' }, idem())).statusCode).toBe(403);
    expect((await accountant.post('/api/docs/tax.bir_payment/post', { input: july, expectedTotalCents: 240_571, businessDate: '2026-08-13' }, idem())).json().code).toBe('BAD_DATE');
    const p1 = await record(july, accountant, '2026-08-10');
    expect(p1).toMatchObject({ number: 'BIRP-000001', businessDate: '2026-08-10', warnings: [] });
    expect(journal(p1.id)).toEqual(['1111 Cr 2,405.71', '2311 Dr 1,785.71 Sample Lessor Corp.', '2311 Dr 120.00 Sample Print Shop Co.', `2311 Dr 500.00 ${CONSULTANT}`]);
    expect(env.db.prepare("SELECT business_date FROM journals WHERE source_type = 'document' AND source_id = ?").pluck().get(p1.id)).toBe('2026-08-10');
    expect((await accountant.get(`/api/docs/tax.bir_payment/${p1.id}`)).json().doc.lines.map((l: { name: string; amountCents: number }) => [l.name, l.amountCents])).toEqual([
      ['Juan Sample', 50_000], ['Sample Lessor Corp.', 178_571], ['Sample Print Shop Co.', 12_000],
    ]);

    // August: rent 1,785.71 and an audit fee 1,000.00 (10% of 10,000.00).
    await goTo('2026-08-14');
    await rent('2026-08-14');
    await bill(auditor, 'SI-3001', '2026-08-14', [{ categoryId: cat('6190'), amountCents: 1_120_000 }]);
    await goTo('2026-09-14');
    const aug = pay({ form: '0619-E', period: '2026-08', amountCents: 200_000, reference: 'eFPS 0914-0002' });
    expect(codes((await preview({ ...aug, amountCents: 278_572 })).issues)).toEqual(['OVER']);
    expect(codes((await preview(aug)).issues, 'warning')).toEqual(['UNDER', 'LATE']);
    // ₱2,000.00 of ₱2,785.71 now, spread in proportion (1,000.00 : 1,785.71), with ₱250.00 surcharge and interest.
    const p2 = await record({ ...aug, penaltyCents: 25_000 });
    expect(p2).toMatchObject({ number: 'BIRP-000002', totalCents: 225_000 });
    expect(codes(p2.warnings, 'warning')).toEqual(['UNDER']);
    expect(journal(p2.id)).toEqual(['1111 Cr 2,250.00', '2311 Dr 717.95 Sample Audit Firm', '2311 Dr 1,282.05 Sample Lessor Corp.', '6290 Dr 250.00']);
    expect(codes((await preview(pay({ form: '0619-E', period: '2026-07', amountCents: 1 }))).issues)).toEqual(['NOTHING_DUE']);

    // September has no 0619-E; the 1601-EQ before the quarter ends is only warned.
    await goTo('2026-09-15');
    await rent('2026-09-15');
    expect(codes((await preview(pay({ form: '0619-E', period: '2026-09', amountCents: 178_571 }))).issues)).toEqual(['THIRD_MONTH']);
    expect(codes((await preview(pay({ form: '0619-E', period: '2026-Q3', amountCents: 1 }))).issues)).toEqual(['PERIOD']);
    expect(codes((await preview(pay({ form: '1601-EQ', period: '2026-10', amountCents: 1 }))).issues)).toEqual(['PERIOD']);
    expect(codes((await preview(pay({ form: '1601-EQ', period: '2026-Q4', amountCents: 1 }))).issues)).toEqual(['PERIOD_AHEAD', 'NOTHING_DUE']);
    expect(codes((await preview(pay({ form: '1601-EQ', period: '2026-Q3', amountCents: 257_142 }))).issues, 'warning')).toEqual(['PERIOD_OPEN']);

    // The 1601-EQ: the quarter's 6,977.13 less the 0619-E payments (2,405.71 + 2,000.00) = 2,571.42, per payee.
    await goTo('2026-10-20');
    const eq = pay({ form: '1601-EQ', period: '2026-Q3', amountCents: 257_142, reference: 'eFPS 1020-0003' });
    expect(codes((await preview({ ...eq, amountCents: 257_143 })).issues)).toEqual(['OVER']);
    const p3 = await record(eq);
    expect([p3.number, p3.warnings]).toEqual(['BIRP-000003', []]);
    expect(journal(p3.id)).toEqual(['1111 Cr 2,571.42', '2311 Dr 282.05 Sample Audit Firm', '2311 Dr 2,289.37 Sample Lessor Corp.']);
    expect(balance('2311')).toBe(0);
    // Once the 1601-EQ is paid, a month of its quarter is paid with it.
    expect(codes((await preview(pay({ form: '0619-E', period: '2026-08', amountCents: 1 }))).issues)).toEqual(['QUARTER_PAID']);

    // Cancel mirrors it, and the quarter is payable again.
    expect((await cancel(p3.id)).statusCode).toBe(200);
    expect(journal(p3.id, 'reversal')).toEqual(['1111 Dr 2,571.42', '2311 Cr 282.05 Sample Audit Firm', '2311 Cr 2,289.37 Sample Lessor Corp.']);
    expect((await preview(eq)).doc.payableCents).toBe(257_142);
    expect(codes((await preview(pay({ form: '0619-E', period: '2026-08', amountCents: 78_571 }))).issues)).toEqual([]);
    expect(balance('2311')).toBe(-257_142);

    // Encoders see no BIR payments.
    expect((await encoder.get('/api/docs/tax.bir_payment')).statusCode).toBe(403);
    noBrokenInvariants();
  });

  it('the EWT register and the 2307s to issue leave BIR payments out, so they do not move when EWT is paid or the payment is cancelled', async () => {
    await goTo('2026-08-10');
    const before = { register: (await accountant.get('/api/tax/registers/ewt?from=2026-07-01&to=2026-09-30')).json(), certificates: (await accountant.get('/api/tax/2307-to-issue?year=2026&quarter=3')).json() };
    expect(before.register).toMatchObject({ totals: { ewtCents: 240_571 }, glEwtCents: 240_571 });
    const paid = await record(pay({ form: '0619-E', period: '2026-07', amountCents: 240_571 }));
    await goTo('2026-08-11');
    expect((await cancel(paid.id)).statusCode).toBe(200);
    await record(pay({ form: '0619-E', period: '2026-07', amountCents: 100_000 }));

    const register = (await accountant.get('/api/tax/registers/ewt?from=2026-07-01&to=2026-09-30')).json();
    expect(register).toEqual(before.register);
    expect(register.rows.map((r: { docType: string }) => r.docType)).toEqual(['exp.voucher', 'ap.bill', 'exp.voucher']);
    expect((await accountant.get('/api/tax/2307-to-issue?year=2026&quarter=3')).json()).toEqual(before.certificates);
    // 2311 is the register less what was paid to the BIR.
    expect(balance('2311')).toBe(-(240_571 - 100_000));
    noBrokenInvariants();
  });

  it('the 0619-E and 1601-EQ worksheets: EWT by ATC, the payments made and what is left; the QAP per payee; CSV', async () => {
    await goTo('2026-08-10');
    await record(pay({ form: '0619-E', period: '2026-07', amountCents: 240_571, reference: 'eFPS 0810-0001' }));
    const july = (await accountant.get('/api/tax/0619e?month=2026-07')).json();
    expect(july).toMatchObject({ month: '2026-07', label: 'July 2026', returnDue: '2026-08-10', dueCents: 240_571, paidCents: 240_571, leftCents: 0, payments: [{ number: 'BIRP-000001' }] });
    expect(july.atcs).toEqual([
      { atc: null, ewtClass: 'contractor_2', atcChoices: ['WI120', 'WC120'], baseCents: 600_000, ewtCents: 12_000 },
      { atc: null, ewtClass: 'rent_5', atcChoices: ['WI100', 'WC100'], baseCents: 3_571_429, ewtCents: 178_571 },
      { atc: 'WI010', ewtClass: 'prof_ind_5', atcChoices: ['WI010'], baseCents: 1_000_000, ewtCents: 50_000 },
    ]);
    expect(july.checks.map((c: { code: string }) => c.code)).toEqual(['ATC_TO_CONFIRM']);
    expect((await accountant.get('/api/tax/0619e?month=2026-07&format=csv')).body.split('\r\n').slice(0, 7)).toEqual([
      '﻿"Item","ATC","EWT class","Base","EWT"',
      '"EWT withheld","ATC to confirm (WI120 or WC120)","contractor_2","6000.00","120.00"',
      '"EWT withheld","ATC to confirm (WI100 or WC100)","rent_5","35714.29","1785.71"',
      '"EWT withheld","WI010","prof_ind_5","10000.00","500.00"',
      '"Total due","","","51714.29","2405.71"',
      '"Paid BIRP-000001 on 2026-08-10 (eFPS 0810-0001)","","","","2405.71"',
      '"Left to pay","","","","0.00"',
    ]);
    expect((await accountant.get('/api/tax/0619e?month=2026-09')).json().code).toBe('THIRD_MONTH');
    expect((await accountant.get('/api/tax/0619e?month=2026-7')).json().code).toBe('BAD_MONTH');

    await goTo('2026-08-14');
    await bill(auditor, 'SI-3001', '2026-08-14', [{ categoryId: cat('6190'), amountCents: 1_120_000 }]);
    await goTo('2026-10-05');
    const q3 = (await accountant.get('/api/tax/1601eq?year=2026&quarter=3')).json();
    expect(q3).toMatchObject({
      period: '2026-Q3', returnDue: '2026-11-02', totals: { baseCents: 6_171_429, ewtCents: 340_571 },
      remittances: [{ month: '2026-07', paidCents: 240_571 }, { month: '2026-08', paidCents: 0, payments: [] }],
      remittedCents: 240_571, dueCents: 100_000, payments: [], paidCents: 0, leftCents: 100_000,
    });
    expect(q3.atcs.map((l: { atc: string | null; ewtClass: string; ewtCents: number }) => [l.atc ?? l.ewtClass, l.ewtCents])).toEqual([['contractor_2', 12_000], ['rent_5', 178_571], ['WC010', 100_000], ['WI010', 50_000]]);
    expect(q3.qap).toEqual([
      { supplierId: CONSULTANT, tin: '777-888-999-000', registeredName: 'Juan Sample', atc: 'WI010', ewtClass: 'prof_ind_5', atcChoices: ['WI010'], baseCents: 1_000_000, rateBp: 500, ewtCents: 50_000 },
      { supplierId: auditor, tin: '555-666-777-000', registeredName: 'Sample Audit Firm', atc: 'WC010', ewtClass: 'prof_firm_10', atcChoices: ['WC010'], baseCents: 1_000_000, rateBp: 1_000, ewtCents: 100_000 },
      { supplierId: lessor, tin: '333-444-555-000', registeredName: 'Sample Lessor Corp.', atc: null, ewtClass: 'rent_5', atcChoices: ['WI100', 'WC100'], baseCents: 3_571_429, rateBp: 500, ewtCents: 178_571 },
      { supplierId: printer, tin: '222-333-444-000', registeredName: 'Sample Print Shop Co.', atc: null, ewtClass: 'contractor_2', atcChoices: ['WI120', 'WC120'], baseCents: 600_000, rateBp: 200, ewtCents: 12_000 },
    ]);
    const csv = (await accountant.get('/api/tax/1601eq?year=2026&quarter=3&format=csv')).body.split('\r\n');
    expect(csv.slice(5, 11)).toEqual([
      '"Total EWT of the quarter","","","61714.29","3405.71"',
      '"Less 0619-E for July 2026: BIRP-000001 on 2026-08-10 (eFPS 0810-0001)","","","","2405.71"',
      '"Less 0619-E for August 2026: none recorded","","","","0.00"',
      '"Due with the 1601-EQ","","","","1000.00"',
      '"Left to pay","","","","1000.00"',
      '"Check: Some EWT is of a class that can be an individual or a company: confirm the ATC of each payee before filing.","","","",""',
    ]);
    expect(csv.slice(12, 15)).toEqual(['"QAP"', '"TIN","Registered name","ATC","Base","Rate","EWT withheld"', '"777-888-999-000","Juan Sample","WI010","10000.00","5%","500.00"']);
    expect((await encoder.get('/api/tax/1601eq?year=2026&quarter=3')).statusCode).toBe(403);
    expect((await encoder.get('/api/tax/0619e?month=2026-07')).statusCode).toBe(403);
  });
});

describe('VAT: the 2550Q pays what the VAT close made payable (D5 VAT-PAY)', () => {
  it('in two parts, the second late with a penalty; more is refused; the close cannot be cancelled under its payments; cancel mirrors', async () => {
    env = await createTestEnv(); encoderOwnDefaults(env); // 2026-09-28
    await goTo('2026-09-28');
    BDO = cashPlaceId(env.db, '1111');
    const c = seedCustomers(env.db, encoder.userId);
    const jv = (memo: string, lines: unknown[], cents: number) => accountant.post('/api/docs/acc.jv/post', { input: { memo, lines }, expectedTotalCents: cents }, idem());
    // Q3: ₱12,000.00 output VAT and ₱4,000.00 input VAT: ₱8,000.00 payable at the close.
    posted(await jv('Output VAT on a sale', [{ accountId: account('1101'), debitCents: 1_200_000 }, { accountId: account('2301'), party: { type: 'customer', id: c.school }, creditCents: 1_200_000 }], 1_200_000));
    posted(await jv('Input VAT on thread', [{ accountId: account('1401'), party: { type: 'supplier', id: 'SUP-TEST-1' }, debitCents: 400_000 }, { accountId: account('1101'), creditCents: 400_000 }], 400_000));
    const vat = (amountCents: number, o: Partial<BirPaymentInput> = {}) => pay({ form: '2550Q', period: '2026-Q3', amountCents, ...o });
    expect(codes((await preview(vat(800_000))).issues)).toEqual(['NOT_CLOSED']);

    await goTo('2026-10-05');
    const close = (await accountant.post('/api/docs/tax.vat_close/post', { input: { year: 2026, quarter: 3 }, expectedTotalCents: 1_200_000 }, idem())).json();
    expect(close.number).toBe('VATC-000001');
    await goTo('2026-10-20');
    expect(codes((await preview(vat(800_001))).issues)).toEqual(['OVER']);
    expect(codes((await preview(vat(500_000), accountant, '2026-10-02')).issues)).toEqual(['BEFORE_CLOSE']);
    const p1 = await record(vat(500_000, { reference: 'eFPS 1020-0001' }));
    expect(codes(p1.warnings, 'warning')).toEqual(['UNDER']);
    expect(journal(p1.id)).toEqual(['1111 Cr 5,000.00', '2302 Dr 5,000.00']);
    expect((await accountant.get(`/api/docs/tax.bir_payment/${p1.id}`)).json().doc).toMatchObject({ vatClose: { documentId: close.id, number: 'VATC-000001', date: '2026-10-05' }, payableCents: 800_000, lines: [] });
    expect(codes((await preview(vat(300_001))).issues)).toEqual(['OVER']);

    // Due 2026-10-26 (the 25th is a Sunday). Paid on the 27th with ₱75.00 surcharge and interest.
    await goTo('2026-10-27');
    const late = await preview(vat(300_000, { reference: 'eFPS 1027-0002' }));
    expect([codes(late.issues), codes(late.issues, 'warning')]).toEqual([[], ['LATE']]);
    const p2 = await record(vat(300_000, { reference: 'eFPS 1027-0002', penaltyCents: 7_500 }));
    expect(p2.warnings).toEqual([]);
    expect(journal(p2.id)).toEqual(['1111 Cr 3,075.00', '2302 Dr 3,000.00', '6290 Dr 75.00']);
    expect([balance('2302'), balance('6290')]).toEqual([0, 7_500]);
    expect(codes((await preview(vat(1))).issues)).toEqual(['NOTHING_DUE']);

    const blocked = await cancel(close.id, 'tax.vat_close');
    expect([blocked.statusCode, blocked.json().details.map((d: { number: string }) => d.number)]).toEqual([409, ['BIRP-000001', 'BIRP-000002']]);
    expect((await cancel(p2.id)).statusCode).toBe(200);
    expect(journal(p2.id, 'reversal')).toEqual(['1111 Dr 3,075.00', '2302 Cr 3,000.00', '6290 Cr 75.00']);
    expect([balance('2302'), balance('6290')]).toEqual([-300_000, 0]);
    expect((await preview(vat(300_000))).doc.payableCents).toBe(300_000);
    noBrokenInvariants();
  });
});
