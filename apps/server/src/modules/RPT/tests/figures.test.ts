import { afterEach, describe, expect, it } from 'vitest';
import { cashPlaceId, type TestEnv } from '../../../../test/helpers.ts';
import { accountBalance } from '../../../engine/ledger/queries.ts';
import { tx } from '../../../platform/db/driver.ts';
import { billDoc } from '../../AP/doctypes/bill.ts';
import { paymentDoc } from '../../AP/doctypes/payment.ts';
import { countDoc } from '../../CASH/doctypes/count.ts';
import { otherReceiptDoc } from '../../CASH/doctypes/other-receipt.ts';
import { transferDoc } from '../../CASH/doctypes/transfer.ts';
import { voucherDoc } from '../../EXP/doctypes/voucher.ts';
import { buyDoc } from '../../FA/doctypes/buy.ts';
import { depreciationDoc } from '../../FA/doctypes/depreciation.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { releaseDoc as jobReleaseDoc } from '../../JO/doctypes/release.ts';
import { invoiceRecordDoc } from '../../JO/doctypes/invoice-record.ts';
import { collectionDoc } from '../../COL/doctypes/collection.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { releaseDoc as payReleaseDoc } from '../../PAY/doctypes/release.ts';
import { world } from '../../PAY/tests/world.ts';
import { entryDoc } from '../../PRD/doctypes/entry.ts';
import { setupLine } from '../../PRD/production.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.app.close(); env = undefined; });

const month = '2026-09';
const from = `${month}-01`;
const to = `${month}-30`;
const account = (db: TestEnv['db'], code: string) => db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const gl = (db: TestEnv['db'], code: string) => accountBalance(db, account(db, code), { asOf: to });
const csvTotal = (body: string, heading: string) => {
  const rows = body.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '')));
  const column = rows[0]!.indexOf(heading);
  expect(column).toBeGreaterThanOrEqual(0);
  return rows.slice(1).reduce((sum, row) => sum + Math.round(Number(row[column]) * 100), 0);
};

/** One made-up September, deliberately crossing every report-to-ledger boundary in this regression test. */
describe('RPT report figures', () => {
  it('ties screen and CSV figures to posted documents and their ledger accounts', async () => {
    const w = await world(to); env = w.env;
    const owner = await env.as('owner');
    const cash = cashPlaceId(env.db, '1101');
    const petty = cashPlaceId(env.db, '1102');
    const bdo = cashPlaceId(env.db, '1111');
    const china = cashPlaceId(env.db, '1112');

    const customers = seedCustomers(env.db, w.userId);
    const jo = w.record(jobOrderDoc, { customerId: customers.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [
      { kind: 'made_to_order', description: 'Sample team shirts', qty: 20, unitPriceCents: 280_000, discountCents: 0, roster: [] },
    ] });
    const worker = w.person('Mila Sample', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
    tx(env.db, () => setupLine(env!.db, jo.id, 1, { templateId: 1, stepIds: [4, 6, 8], garmentType: 'T-shirt', complexity: 'standard' }, w.who()));
    w.record(entryDoc, { jobOrderId: jo.id, stepId: 6, rows: [{ lineNo: 1, employeeId: worker, pieces: 20 }], overCapReason: 'Sample work entered after cutting was completed off-system' });
    await owner.post(`/api/jo/orders/${jo.id}/stage`, { from: 'in_production', to: 'ready' });
    w.record(collectionDoc, { customerId: customers.school, crNumber: '22001', applications: [{ jobOrderId: jo.id, amountCents: 2_800_000 }], tenders: [{ cashPlaceId: cash, amountCents: 2_800_000 }] });
    const release = w.record(jobReleaseDoc, { jobOrderId: jo.id, lines: [{ lineNo: 1, qty: 20 }], claimedBy: 'Coach Sample', idSeen: 'school_id', creditNote: 'Made-up balance for report test', creditDueInDays: 7 });
    w.record(invoiceRecordDoc, { releaseId: release.id, invoiceNumber: '220501' });

    const supplier = (await owner.post('/api/pur/suppliers', { name: 'Sample Cloth Trading', registeredName: 'Sample Cloth Trading Inc.', tin: '111-222-333-000', isVatRegistered: true })).json().id as string;
    const supply = (await owner.post('/api/pur/supplies', { name: 'Sample cotton', unit: 'yard', category: 'materials' })).json().id as string;
    const bill = w.record(billDoc, { supplierId: supplier, supplierInvoiceNo: 'C22-BILL', supplierInvoiceDate: to, lines: [{ supplyId: supply, amountCents: 1_120_000 }] });
    w.record(paymentDoc, { supplierId: supplier, bills: [{ billId: bill.id, amountCents: 500_000 }], tenders: [{ cashPlaceId: bdo, amountCents: 500_000 }] });

    const category = (code: string) => env!.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id=c.account_id WHERE a.code=?').pluck().get(code) as number;
    const rent = category('6110');
    const transport = category('6140');
    w.record(voucherDoc, { categoryId: rent, cashPlaceId: bdo, amountCents: 400_000, description: 'Sample workshop rent', payeeName: 'Sample Landlord', payeeVatRegistered: false, payeeTin: '987-654-321-000', supplierInvoiceNo: 'C22-RENT', supplierInvoiceDate: to });
    w.record(transferDoc, { fromCashPlaceId: bdo, toCashPlaceId: china, amountSentCents: 100_000, amountReceivedCents: 99_500 });

    const assetSupplier = (await owner.post('/api/pur/suppliers', { name: 'Sample Machine Shop', registeredName: 'Sample Machine Shop Inc.', tin: '222-333-444-000', isVatRegistered: true })).json().id as string;
    w.record(buyDoc, { classCode: 'machinery', description: 'Sample heat press', supplierId: assetSupplier, supplierInvoiceNo: 'C22-ASSET', supplierInvoiceDate: to, amountCents: 1_120_000, residualCents: 100_000, cashPlaceId: bdo, paidCents: 300_000, financedCents: 820_000, lender: 'Sample Finance' });
    w.record(depreciationDoc, { month });

    const payRun = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
    const payslip = runDoc.load(env.db, payRun.id).employees[0]!;
    w.record(payReleaseDoc, { runId: payRun.id, employeeIds: [worker], tenders: [{ cashPlaceId: petty, amountCents: payslip.netCents }] });

    // More than one loose-leaf page proves brought/carried totals, while still using ordinary posted documents.
    for (let n = 0; n < 20; n++) {
      w.record(otherReceiptDoc, { cashPlaceId: cash, category: 'other_income', receivedFrom: `Sample buyer ${n + 1}`, description: 'Sample scrap', amountCents: 100 });
      w.record(voucherDoc, { categoryId: transport, cashPlaceId: petty, amountCents: 100, description: `Sample sundry ${n + 1}`, payeeName: `Sample payee ${n + 1}`, payeeVatRegistered: false });
    }
    const counted = gl(env.db, '1101');
    w.record(countDoc, { cashPlaceId: cash, lines: [{ denominationCents: 100, qty: counted / 100 }] });

    const ap = (await owner.get(`/api/rpt/ap-aging?asOf=${to}`)).json();
    const tb = (await owner.get(`/api/rpt/trial-balance?asOf=${to}`)).json();
    const apAccount = tb.rows.find((r: { code: string }) => r.code === '2101');
    expect(ap.totalCents).toBe(620_000);
    expect(ap.totalCents).toBe(apAccount.creditCents - apAccount.debitCents);
    expect(csvTotal((await owner.get(`/api/rpt/ap-aging?asOf=${to}&format=csv`)).body, 'balanceCents')).toBe(ap.totalCents);

    const cashPosition = (await owner.get(`/api/rpt/cash-position?asOf=${to}`)).json();
    for (const row of cashPosition.rows) expect(row.balanceCents).toBe(accountBalance(env.db, row.id, { asOf: to }));
    expect(cashPosition.totalCents).toBe(cashPosition.rows.reduce((sum: number, row: { balanceCents: number }) => sum + row.balanceCents, 0));
    expect(csvTotal((await owner.get(`/api/rpt/cash-position?asOf=${to}&format=csv`)).body, 'balanceCents')).toBe(cashPosition.totalCents);

    const assets = (await owner.get(`/api/rpt/assets?asOf=${to}`)).json();
    expect(assets.totalCostCents).toBe(gl(env.db, '1510'));
    expect(assets.totalAccumulatedCents).toBe(-gl(env.db, '1511'));
    const assetCsv = (await owner.get(`/api/rpt/assets?asOf=${to}&format=csv`)).body;
    expect(csvTotal(assetCsv, 'costCents')).toBe(assets.totalCostCents);
    expect(csvTotal(assetCsv, 'accumulatedDepreciationCents')).toBe(assets.totalAccumulatedCents);

    const payroll = (await owner.get(`/api/rpt/payroll-register?month=${month}`)).json();
    const employeeShares = payslip.sssEeCents + payslip.phicEeCents + payslip.hdmfEeCents;
    const employerShares = payslip.sssErCents + payslip.sssEcCents + payslip.phicErCents + payslip.hdmfErCents;
    expect(payroll.totals).toMatchObject({ grossCents: payslip.grossCents, employeeSharesCents: employeeShares, employerSharesCents: employerShares,
      taxCents: payslip.wtaxCents, loanCents: payslip.loanCents, netCents: payslip.netCents });
    const journal = env.db.prepare(`SELECT SUM(l.debit_cents) debit, SUM(l.credit_cents) credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.source_id=? AND j.posting_kind='original'`).get(payRun.id) as { debit: number; credit: number };
    expect(journal.debit).toBe(journal.credit);
    expect(journal.credit).toBe(payroll.totals.netCents + payroll.totals.employeeSharesCents + payroll.totals.employerSharesCents + payroll.totals.taxCents + payroll.totals.loanCents + payroll.totals.caCents + payroll.rows[0].accruedCents);
    const payrollCsv = (await owner.get(`/api/rpt/payroll-register?month=${month}&format=csv`)).body;
    const payrollHeadings: Record<string, string> = { grossCents: 'Gross PHP', employeeSharesCents: 'Employee shares PHP', employerSharesCents: 'Employer shares PHP', taxCents: 'Tax PHP', loanCents: 'Loans PHP', caCents: 'CA PHP', netCents: 'Net PHP' };
    for (const [key, total] of Object.entries(payroll.totals)) expect(csvTotal(payrollCsv, payrollHeadings[key]!)).toBe(total);

    for (const [book, side] of [['cash-receipts', 'debit_cents'], ['cash-disbursements', 'credit_cents']] as const) {
      const screen = (await owner.get(`/api/rpt/bir-books/${book}?from=${from}&to=${to}`)).json();
      const ledgerCash = env.db.prepare(`SELECT COALESCE(SUM(l.${side}),0) FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE j.business_date BETWEEN ? AND ? AND j.sealed=1 AND a.is_cash_place=1`).pluck().get(from, to);
      expect(screen.totals.cashCents).toBe(ledgerCash);
      expect(screen.pages.length).toBeGreaterThan(1);
      for (let page = 1; page < screen.pages.length; page++) expect(screen.pages[page].broughtForward).toEqual(screen.pages[page - 1].carriedForward);
      expect(csvTotal((await owner.get(`/api/rpt/bir-books/${book}?from=${from}&to=${to}&format=csv`)).body, 'cashCents')).toBe(screen.totals.cashCents);
    }
  });
});
