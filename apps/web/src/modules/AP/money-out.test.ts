/** The money-out screens' rules (bills, payments, expense vouchers, owner and officer money), and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key, type ApLedger, type EqPerson, type Preview } from '../../api.ts';
import { emptyTender } from '../COL/money.ts';
import { emptyVoucher, voucherInput, voucherValues, type VoucherInput } from '../EXP/voucher.ts';
import { classificationsFor, emptyEq, eqValues, officerInput, ownerMoneyInput, personLabel } from '../EQ/eq.ts';
import {
  billFigures, billLinesToInput, billLinesToRows, emptyBillLine, ewtChoices, ewtLabel, ewtRates, forReplacement, openBills, paymentInput, voucherFigures,
} from './payables.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

const rates = { rent_5: 500, contractor_2: 200, prof_ind_5: 500, prof_ind_10: 1000, prof_firm_10: 1000, prof_firm_15: 1500, goods_1: 100, services_2: 200 };
const ledger = (bills: Partial<ApLedger['bills'][number]>[]): ApLedger => ({
  supplierId: 's1', supplierName: 'Sample Fabric Trading', balanceCents: 0, advancesCents: 0, advances: [],
  bills: bills.map((b, i) => ({ id: `b${i}`, number: `BILL-00000${i + 1}`, status: 'posted', supplierInvoiceNo: `SI-${i}`, dueDate: '2026-10-25', payableCents: 0, owedCents: 0, ...b })),
});

describe('money-out screen rules', () => {
  it('names each EWT class with the rate in force, and offers the usual class first', () => {
    expect(ewtLabel('rent_5', rates)).toBe('Rent 5%');
    expect(ewtLabel('prof_firm_15', rates)).toBe('Professional fees, firm (higher rate) 15%');
    expect(ewtLabel('goods_1', null)).toBe('Goods (Top Withholding Agent only)');
    expect([null, 'none'].map((c) => ewtLabel(c, rates))).toEqual(['No tax withheld (EWT)', 'No tax withheld (EWT)']);
    expect(ewtRates([{ key: 'tax.ewt_rates_bp', label: '', current: rates, versions: [] }])).toBe(rates);
    expect(ewtRates([])).toBeNull();
    const choices = ewtChoices('contractor_2', rates);
    expect(choices.slice(0, 3)).toEqual([['', 'Usual: Contractors and printers 2%'], ['none', 'No tax withheld (EWT)'], ['rent_5', 'Rent 5%']]);
    expect(choices).toHaveLength(10);
    expect(ewtChoices(null, rates)[0]).toEqual(['', 'Usual: No tax withheld (EWT)']);
  });

  it('bill lines: a supply, an expense category, subcontracting or freight-in; blank rows are left out', () => {
    const rows = [
      { for: 'supply:sup-1', description: '', amount: '11,200.00' },
      emptyBillLine(),
      { for: 'category:7', description: ' Shop electricity ', amount: '2500' },
      { for: 'freight_in', description: 'Delivery', amount: '560' },
    ];
    const { lines, errors } = billLinesToInput(rows);
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      { supplyId: 'sup-1', amountCents: 1_120_000 },
      { categoryId: 7, description: 'Shop electricity', amountCents: 250_000 },
      { purchase: 'freight_in', description: 'Delivery', amountCents: 56_000 },
    ]);
    expect(billLinesToInput(billLinesToRows(lines)).lines).toEqual(lines);
    expect(billLinesToInput([emptyBillLine()]).errors).toEqual(['Add what the invoice is for.']);
    expect(billLinesToInput([{ for: '', description: 'x', amount: '0' }, { for: 'category:x', description: '', amount: '1.234' }]).errors).toEqual([
      'Line 1: pick what it is for.', 'Line 1: type the amount on the invoice, like 1,250.00', 'Line 2: pick what it is for.', 'Line 2: type the amount on the invoice, like 1,250.00',
    ]);
  });

  it('open bills: recorded ones with something owed, oldest due first; an edited payment counts back what it paid', () => {
    const l = ledger([
      { dueDate: '2026-11-30', owedCents: 300_000 },
      { dueDate: '2026-10-25', owedCents: 0 },
      { dueDate: '2026-10-01', owedCents: 100_000, status: 'cancelled' },
      { dueDate: '2026-10-10', owedCents: 50_000 },
    ]);
    expect(openBills(l).map((b) => [b.id, b.owedCents])).toEqual([['b3', 50_000], ['b0', 300_000]]);
    expect(openBills(l, [{ billId: 'b1', amountCents: 200_000 }]).map((b) => [b.id, b.owedCents])).toEqual([['b3', 50_000], ['b1', 200_000], ['b0', 300_000]]);
    expect(openBills(l)[0]!.label).toBe('BILL-000004 · invoice no. SI-3 · due 2026-10-10');
  });

  it('payment: what is paid per bill, one tender left empty pays the bills and the fee, and the typing slips', () => {
    const bills = openBills(ledger([{ owedCents: 620_000 }, { owedCents: 100_000 }]));
    const tender = { cashPlaceId: '6', amount: '', reference: 'Check 000123' };
    const v = { supplierId: 's1', bills, pay: { b0: '5,000', b1: '' }, tenders: [tender], fee: '15', note: '' };
    expect(paymentInput(v)).toEqual({
      input: { supplierId: 's1', bills: [{ billId: 'b0', amountCents: 500_000 }], tenders: [{ cashPlaceId: 6, amountCents: 501_500, reference: 'Check 000123' }], feeCents: 1_500 }, errors: [],
    });
    const split = paymentInput({ ...v, tenders: [{ ...tender, amount: '3,000' }, { cashPlaceId: '3', amount: '2,015', reference: '' }], note: ' Partial ' }).input;
    expect(split.tenders.map((t) => t.amountCents)).toEqual([300_000, 201_500]);
    expect(split.note).toBe('Partial');
    expect(paymentInput({ ...v, supplierId: '', bills: [] }).errors).toEqual(['Pick the supplier.']);
    expect(paymentInput({ ...v, pay: {}, fee: '' }).errors).toEqual(['Type what is paid on at least one bill.', 'Payment 1: type an amount like 1,250.00']);
    expect(paymentInput({ ...v, pay: { b0: '1.234' }, fee: 'abc', tenders: [emptyTender()] }).errors).toEqual([
      'BILL-000001 · invoice no. SI-0 · due 2026-10-25: type an amount like 1,250.00', 'Type the bank fee like 15.00, or leave it empty.', 'Type the amount and pick where the money went.',
    ]);
  });

  it("an edit's preview drops only the checks its own original causes", () => {
    const issue = (code: string, message: string, field = 'x') => ({ level: 'error' as const, code, field, message });
    const p: Preview = {
      totalCents: 1, summary: '', issues: [
        issue('DUPLICATE_INVOICE', 'Invoice no. SI-7788 of this supplier is already on BILL-000001.'),
        issue('DUPLICATE_RECEIPT', 'Receipt no. OR-1 of this payee is already on EXP-000009.'),
        issue('MORE_THAN_OWED', 'Only ₱1.00 is still owed on BILL-000002.', 'bills.0.amountCents'),
        issue('MORE_THAN_OWED', 'BILL-000003 is fully paid.', 'bills.1.amountCents'),
        { ...issue('EWT_DIFFERENT', 'The usual EWT for this supplier is none. Please check.'), level: 'warning' },
      ],
    };
    const codes = (x: Preview) => x.issues.map((i) => `${i.code} ${i.field}`);
    expect(codes(forReplacement(p, 'BILL-000001', (f) => f === 'bills.0.amountCents'))).toEqual(['DUPLICATE_RECEIPT x', 'MORE_THAN_OWED bills.1.amountCents', 'EWT_DIFFERENT x']);
    expect(codes(forReplacement(p, 'EXP-000009'))).toHaveLength(4);
  });

  it('shows the figures the server worked out, with the EWT class and the rate it used', () => {
    expect(billFigures({ inputVatCents: 120_000, appliedEwtClass: 'goods_1', ewtRateBp: 100, ewtCents: 10_000, payableCents: 1_110_000, dueDate: '2026-10-25' })).toEqual([
      ['Input VAT', 120_000], ['Tax withheld from supplier (EWT) (Goods (Top Withholding Agent only) 1%)', 10_000], ['Owed to the supplier, due 2026-10-25', 1_110_000],
    ]);
    expect(voucherFigures({ expenseCents: 3_571_429, inputVatCents: 428_571, appliedEwtClass: 'rent_5', ewtRateBp: 1000, ewtCents: 357_143, cashCents: 3_642_857 })[2]).toEqual(['Tax withheld from supplier (EWT) (Rent 10%)', 357_143]);
    expect(voucherFigures({ expenseCents: 5_000, inputVatCents: 0, appliedEwtClass: null, ewtRateBp: 0, ewtCents: 0, cashCents: 5_000 })[2]).toEqual(['Tax withheld from supplier (EWT)', 0]);
  });

  it('expense voucher: a supplier on file or someone else, the receipt only when typed, and back for an edit', () => {
    const v = { ...emptyVoucher(), categoryId: '2', description: 'Shop rent', payeeName: 'Sample Landlord', payeeVatRegistered: true, payeeTin: '123-456-789-000', amount: '40,000.00', receiptNo: 'OR-1001', receiptDate: '2026-09-27', tenders: [{ cashPlaceId: '6', amount: '38,214.29', reference: '' }] };
    const g13: VoucherInput = {
      categoryId: 2, tenders: [{ cashPlaceId: 6, amountCents: 3_821_429 }], amountCents: 4_000_000, description: 'Shop rent', payeeName: 'Sample Landlord', payeeVatRegistered: true, payeeTin: '123-456-789-000',
      supplierInvoiceNo: 'OR-1001', supplierInvoiceDate: '2026-09-27',
    };
    expect(voucherInput(v)).toEqual({ input: g13, errors: [] });
    expect(voucherValues(g13)).toEqual(v);
    expect(voucherInput({ ...v, payee: 'supplier', supplierId: 'sup-1', ewtClass: 'none' }).input).toEqual({
      categoryId: 2, tenders: [{ cashPlaceId: 6, amountCents: 3_821_429 }], amountCents: 4_000_000, description: 'Shop rent', supplierId: 'sup-1', supplierInvoiceNo: 'OR-1001', supplierInvoiceDate: '2026-09-27', ewtClass: 'none',
    });
    expect(voucherInput({ ...v, receiptNo: ' ', receiptDate: '' }).input).not.toHaveProperty('supplierInvoiceNo');
    expect(voucherInput(emptyVoucher()).errors).toEqual(['Pick what the money was spent on.', 'Say what it was for.', 'Type who was paid.', 'Type the amount on the receipt, like 1,250.00', 'Type the amount and pick where the money went.']);
    expect(voucherInput({ ...v, payeeTin: '123456789', receiptDate: '2026-02-30' }).errors).toEqual(['Type the TIN like 123-456-789-000.', 'Pick the date on the receipt.']);
    expect(voucherInput({ ...v, payee: 'supplier' }).errors).toEqual(['Pick the supplier.']);
  });

  it('owner and officer money: only the accountant classifies a stockholder’s money; in or out, and back for an edit', () => {
    const owner: EqPerson = { id: 'p1', name: 'Maria Santos', isStockholder: true, isOfficer: true, position: 'President' };
    const officer: EqPerson = { id: 'p2', name: 'Pedro Reyes', isStockholder: false, isOfficer: true, position: null };
    expect([personLabel(owner), personLabel(officer)]).toEqual(['Maria Santos (stockholder, President)', 'Pedro Reyes (officer)']);
    expect(classificationsFor(owner, true)).toHaveLength(5);
    expect(classificationsFor(owner, false).map(([k]) => k)).toEqual(['advance']);
    expect(classificationsFor(officer, true).map(([k]) => k)).toEqual(['advance']);
    expect(classificationsFor(owner, false, 'dffs_equity').map(([k]) => k)).toEqual(['advance', 'dffs_equity']);

    const capital = { ...emptyEq('capital_stock'), personId: 'p1', cashPlaceId: '3', amount: '50,000.00', parValue: '40,000.00', note: ' Shares ' };
    expect(ownerMoneyInput(capital)).toEqual({ input: { personId: 'p1', cashPlaceId: 3, amountCents: 5_000_000, classification: 'capital_stock', parValueCents: 4_000_000, note: 'Shares' }, errors: [] });
    expect(ownerMoneyInput({ ...capital, kind: 'advance' }).input).not.toHaveProperty('parValueCents');
    expect(ownerMoneyInput({ ...capital, parValue: '' }).errors).toEqual(['Type the par value of the shares issued.']);
    expect(eqValues(ownerMoneyInput(capital).input)).toEqual({ ...capital, note: 'Shares' });
    expect(ownerMoneyInput(emptyEq('advance')).errors).toEqual(['Pick the owner.', 'Pick where the money went.', 'Type the amount, like 5,000.00']);

    const back = { ...emptyEq('returned'), personId: 'p2', cashPlaceId: '3', amount: '1,000.00', note: 'Paid back in cash' };
    expect(officerInput(back)).toEqual({ input: { personId: 'p2', cashPlaceId: 3, amountCents: 100_000, kind: 'returned', purpose: 'Paid back in cash' }, errors: [] });
    expect(eqValues(officerInput(back).input)).toEqual(back);
    expect(officerInput(emptyEq('')).errors).toEqual(['Pick the officer.', 'Pick in or out.', 'Pick where the money came from.', 'Type the amount, like 5,000.00', 'Say what it was for.']);
    expect(officerInput({ ...back, cashPlaceId: '' }).errors).toEqual(['Pick where the money went.']);
  });
});

describe('money-out web client against server routes', () => {
  it('bill with EWT, its edit on the same invoice number, a payment from AP by supplier, a rent voucher, owner and officer money', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct1', ['accountant']);
    createUser(env.db, 'encoder1', ['encoder']);
    const [accountant, encoder] = [createApi(injectFetch(env.app)), createApi(injectFetch(env.app))];
    await accountant.login('acct1', PASSWORD);
    await encoder.login('encoder1', PASSWORD);
    const server = await env.as('accountant');
    const supplierId = (await server.post('/api/pur/suppliers', { name: 'Sample Print Shop', registeredName: 'Sample Print Shop', tin: '111-222-333-000', isVatRegistered: false, ewtClass: 'contractor_2', paymentTermsDays: 15 })).json().id as string;
    await server.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' });
    const personId = (await server.post('/api/eq/people', { name: 'Sample Stockholder', isStockholder: true, isOfficer: true, position: 'President' })).json().id as string;
    const BDO = String(cashPlaceId(env.db, '1111'));
    const CASH = String(cashPlaceId(env.db, '1101'));

    // The lists the pickers use, as an encoder sees them.
    expect((await encoder.suppliers()).find((s) => s.id === supplierId)).toMatchObject({ name: 'Sample Print Shop', tin: '111-222-333-000', is_vat_registered: 0, ewt_class: 'contractor_2', payment_terms_days: 15 });
    const [twill] = await encoder.supplies();
    const rent = (await encoder.expCategories()).find((c) => c.name === 'Rent')!;
    expect(rent.defaultEwtClass).toBe('rent_5');
    const ratesNow = ewtRates(await encoder.settings());
    expect(ewtChoices('contractor_2', ratesNow)[0]).toEqual(['', 'Usual: Contractors and printers 2%']);
    expect((await encoder.eqPeople()).map(personLabel)).toEqual(['Sample Stockholder (stockholder, President)']);

    // A bill: EWT 2% at accrual on the gross (not VAT-registered), due on the supplier's terms.
    const { lines } = billLinesToInput([{ for: `supply:${twill!.id}`, description: 'Printing', amount: '10,000' }]);
    const bill = { supplierId, supplierInvoiceNo: 'SI-0501', supplierInvoiceDate: '2026-09-25', lines };
    const pre = await encoder.preview('ap.bill', bill);
    expect(billFigures(pre.doc as never)).toEqual([['Input VAT', 0], ['Tax withheld from supplier (EWT) (Contractors and printers 2%)', 20_000], ['Owed to the supplier, due 2026-10-10', 980_000]]);
    const first = await encoder.post('ap.bill', bill, pre.totalCents, key());

    // Its edit is a bill of its own, so it has its own invoice number: the preview still sees the original, the replacement records.
    const again = { ...bill, supplierInvoiceNo: 'SI-0502', lines: [{ ...lines[0]!, amountCents: 1_200_000 }] };
    const stale = await accountant.preview('ap.bill', again);
    expect(stale.issues.map((i) => i.code)).toEqual([]);
    expect(forReplacement(stale, first.number).issues).toEqual([]);
    const second = await accountant.reissue('ap.bill', first.id, again, stale.totalCents, 'The supplier corrected the invoice', key());
    expect(second.number).toBe('BILL-000002');

    // A payment from AP by supplier: one tender without an amount pays the bill and the fee.
    const open = openBills(await encoder.apLedger(supplierId));
    expect(open).toEqual([{ id: second.id, label: 'BILL-000002 · invoice no. SI-0502 · due 2026-10-10', owedCents: 1_176_000 }]);
    const payment = paymentInput({ supplierId, bills: open, pay: { [second.id]: '11,760.00' }, tenders: [{ cashPlaceId: BDO, amount: '', reference: 'Check 000123' }], fee: '15', note: '' });
    expect(payment.errors).toEqual([]);
    const paid = await encoder.post('ap.payment', payment.input, (await encoder.preview('ap.payment', payment.input)).totalCents, key());
    expect(paid.totalCents).toBe(1_177_500);
    expect(openBills(await encoder.apLedger(supplierId))).toEqual([]);
    // Editing that payment: the bill is owed again once it is cancelled.
    const reopened = openBills(await accountant.apLedger(supplierId), payment.input.bills);
    expect(reopened.map((b) => b.owedCents)).toEqual([1_176_000]);
    const edit = paymentInput({ supplierId, bills: reopened, pay: { [second.id]: '11,760.00' }, tenders: [{ cashPlaceId: CASH, amount: '', reference: '' }], fee: '', note: '' }).input;
    const editPreview = await accountant.preview('ap.payment', edit);
    expect(editPreview.issues.map((i) => i.code)).toEqual(['MORE_THAN_OWED']);
    expect(forReplacement(editPreview, paid.number, (f) => f === 'bills.0.amountCents').issues).toEqual([]);
    expect((await accountant.reissue('ap.payment', paid.id, edit, 1_176_000, 'Paid from the cash box instead', key())).number).toBe('SPAY-000002');

    // Golden G-13 through the voucher form's input: rent ₱40,000 from a VAT-registered landlord, EWT 5%.
    // One cash place typed without an amount pays what the server says is paid out (the receipt less the EWT), as the form does.
    const typed = { ...emptyVoucher(), categoryId: String(rent.id), description: 'Shop rent for September', payeeName: 'Sample Landlord', payeeVatRegistered: true,
      payeeTin: '123-456-789-000', amount: '40,000', receiptNo: 'OR-1001', receiptDate: '2026-09-27', tenders: [{ cashPlaceId: BDO, amount: '', reference: '' }] };
    const beforeAnswer = await encoder.preview('exp.voucher', voucherInput(typed).input); // before the server has answered: the receipt itself
    expect(beforeAnswer.issues.map((i) => i.code)).toContain('TENDERS');
    const voucher = voucherInput(typed, (beforeAnswer.doc as { cashCents: number }).cashCents);
    const vp = await encoder.preview('exp.voucher', voucher.input);
    expect(vp.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(voucherFigures(vp.doc as never)).toEqual([['Expense', 3_571_429], ['Input VAT', 428_571], ['Tax withheld from supplier (EWT) (Rent 5%)', 178_571], ['Paid out', 3_821_429]]);
    expect((await encoder.post('exp.voucher', voucher.input, vp.totalCents, key())).number).toBe('EXP-000001');

    // Owner money: the encoder records an advance; the company pays part of it back through an officer transaction.
    const advance = ownerMoneyInput({ ...emptyEq('advance'), personId, cashPlaceId: CASH, amount: '20,000', parValue: '', note: '' }).input;
    await encoder.post('eq.owner_money', advance, (await encoder.preview('eq.owner_money', advance)).totalCents, key());
    const capital = ownerMoneyInput({ ...emptyEq('capital_stock'), personId, cashPlaceId: CASH, amount: '5,000', parValue: '5,000', note: '' }).input;
    expect((await encoder.preview('eq.owner_money', capital)).issues.map((i) => i.code)).toEqual(['CLASSIFY']);
    const repay = officerInput({ ...emptyEq('repaid_to_officer'), personId, cashPlaceId: CASH, amount: '8,000', parValue: '', note: 'Part of the advance' }).input;
    await encoder.post('eq.officer', repay, (await encoder.preview('eq.officer', repay)).totalCents, key());
    expect(await accountant.officerBalances(personId)).toMatchObject({ dueFromCents: 0, dueToCents: 1_200_000 });
    await expect(encoder.officerBalances(personId)).rejects.toMatchObject({ status: 403 });
  });
});
