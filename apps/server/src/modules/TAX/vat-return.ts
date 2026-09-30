/**
 * 2550Q worksheet (PLAN E12, research vat-cwt-ewt §3.8): the figures of the quarterly VAT return, taken from the same
 * place as the quarterly VAT close (vat.ts) and the sales and purchases registers, so the worksheet, the close and the
 * ledger always agree. Output tax and input tax include items dated in an earlier quarter but recorded after that
 * quarter was closed (the next-quarter treatment, Q-V6); they get their own line.
 * The items are named as on the return but carry no line numbers: the accountant checks them against the form in use.
 * Not tracked by the ERP, so shown as nothing: zero-rated and exempt sales, output VAT on uncollected receivables,
 * importations, services by non-residents, purchases with no input VAT, input VAT on unpaid payables.
 */
import type { Db } from '../../platform/db/driver.ts';
import { vatReturnDue, type Quarter } from './calendar.ts';
import { purchasesRegister } from './purchases.ts';
import { salesRegister } from './registers.ts';
import { vatCloseOf, vatPosition } from './vat.ts';

export type WorksheetKey =
  | 'vatable_sales' | 'zero_rated_sales' | 'exempt_sales' | 'late_output' | 'output_tax'
  | 'input_carried_over' | 'capital_goods' | 'goods' | 'services' | 'to_classify' | 'late_input' | 'input_tax'
  | 'net_vat' | 'vat_withheld' | 'payable' | 'carry_forward';

/** One item of the return: the amount of sales or purchases (null where the form has none) and the tax. */
export interface WorksheetLine { key: WorksheetKey; label: string; amountCents: number | null; taxCents: number }
export interface WorksheetCheck { code: string; level: 'error' | 'warning' | 'info'; message: string }

export function vatReturnWorksheet(db: Db, year: number, quarter: Quarter, today: string) {
  const p = vatPosition(db, year, quarter);
  const sales = salesRegister(db, p.from, p.to);
  const purchases = purchasesRegister(db, p.from, p.to);
  const close = vatCloseOf(db, year, quarter) ?? null;
  const c = purchases.byClass;
  const availableCents = p.carryOverCents + p.inputVatCents;

  const lines: WorksheetLine[] = [];
  const add = (key: WorksheetKey, label: string, amountCents: number | null, taxCents: number, always = true) => {
    if (always || amountCents || taxCents) lines.push({ key, label, amountCents, taxCents });
  };
  add('vatable_sales', 'VATable sales', sales.totals.netCents, sales.totals.vatCents);
  add('zero_rated_sales', 'Zero-rated sales', 0, 0);
  add('exempt_sales', 'Exempt sales', 0, 0);
  add('late_output', 'Output VAT on sales dated in an earlier quarter, recorded after its close', null, p.earlierOutputVatCents, false);
  add('output_tax', 'Total output tax due', sales.totals.netCents, p.outputVatCents);
  add('input_carried_over', 'Input tax carried over from the previous quarter', null, p.carryOverCents);
  add('capital_goods', 'Domestic purchases: capital goods', c.capital_goods.netCents, c.capital_goods.vatCents);
  add('goods', 'Domestic purchases: goods other than capital goods', c.goods.netCents, c.goods.vatCents);
  add('services', 'Domestic purchases: services', c.services.netCents, c.services.vatCents);
  add('to_classify', 'Purchases still to classify (journal vouchers on input VAT)', c.unclassified.netCents, c.unclassified.vatCents, false);
  add('late_input', 'Input VAT on purchases dated in an earlier quarter, recorded after its close', null, p.earlierInputVatCents, false);
  add('input_tax', 'Total available input tax', purchases.totals.netCents, availableCents);
  add('net_vat', 'Net VAT payable (excess input tax if negative)', null, p.outputVatCents - availableCents);
  add('vat_withheld', 'Creditable VAT withheld (2307s in hand)', null, p.vatWithheldCents);
  add('payable', 'Tax still payable', null, p.payableCents);
  add('carry_forward', 'Excess input tax carried over to the next quarter', null, p.carryForwardCents);

  const checks: WorksheetCheck[] = [];
  const check = (when: boolean, code: string, level: WorksheetCheck['level'], message: string) => void (when && checks.push({ code, level, message }));
  check(sales.totals.vatCents !== sales.glVatCents, 'SALES_NOT_TIED', 'error', 'The sales register does not add up to output VAT in the books. Do not file until this is fixed.');
  check(purchases.totals.vatCents !== purchases.glVatCents, 'PURCHASES_NOT_TIED', 'error', 'The purchases register does not add up to input VAT in the books. Do not file until this is fixed.');
  check(c.unclassified.vatCents !== 0, 'TO_CLASSIFY', 'warning', 'Some input VAT came from journal vouchers: put each under capital goods, goods or services on the return.');
  check(p.earlierOutputVatCents !== 0 || p.earlierInputVatCents !== 0, 'LATE_ITEMS', 'warning',
    'Some VAT is dated in an earlier quarter but was recorded after that quarter was closed. It is included here; the accountant decides whether to amend the earlier return instead.');
  check(p.vatWithheldPendingCents > 0, 'PENDING_2307', 'warning', 'Some VAT withheld by government buyers still waits for its 2307, so it is not claimed this quarter.');
  check(today <= p.to, 'QUARTER_OPEN', 'info', 'The quarter has not ended: these figures still change.');
  check(today > p.to && !close, 'NOT_CLOSED', 'info', 'Record the VAT close of this quarter before filing, so the books show the same figures.');
  if (close) {
    const booked = db
      .prepare('SELECT payable_cents AS payable, carry_forward_cents AS carryForward FROM tax_vat_closes WHERE document_id = ?')
      .get(close.documentId) as { payable: number; carryForward: number };
    check(booked.payable !== p.payableCents || booked.carryForward !== p.carryForwardCents, 'CHANGED_AFTER_CLOSE', 'warning',
      `Items dated in this quarter were recorded after its close ${close.number}. The close stays as it was; they go to the next quarter's close unless the accountant amends this return.`);
  }

  return { year, quarter, from: p.from, to: p.to, returnDue: vatReturnDue(db, year, quarter), close, lines, checks };
}
export type VatReturnWorksheet = ReturnType<typeof vatReturnWorksheet>;
