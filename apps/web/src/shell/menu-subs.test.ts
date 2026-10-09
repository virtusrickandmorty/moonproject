/** Sidebar sub-categories (the owner's request, Oct 2026): every screen and document list sits under a named one. */
import { expect, it } from 'vitest';
import type { DocTypeInfo } from '../api.ts';
import { SCREENS, buildMenu, sectionsOf, subOf } from './menu.ts';

const DOC_TYPES = 'acc.jv acc.opening ap.advance ap.advance_return ap.bill ap.opening ap.payment ca.advance ca.opening ca.repayment ca.writeoff cash.bank_adj cash.count cash.other_receipt cash.transfer col.allowance col.collection col.credit_memo col.cwt_only col.deposit_transfer col.forfeit col.refund col.write_off eq.dividend eq.dividend_payment eq.officer eq.opening eq.owner_money exp.voucher fa.buy fa.depreciation fa.disposal fa.opening inv.count jo.dp_invoice jo.invoice_record jo.job_order jo.opening jo.release loan.forgiveness loan.loan loan.opening loan.payment pay.release pay.run pay.thirteenth prd.entry pur.po pur.rr qs.sale quo.quotation stat.opening stat.remittance tax.bir_payment tax.it_provision tax.it_settlement tax.uncollected_vat tax.uncollected_vat_recovery tax.vat_close'
  .split(' ').map((key) => ({ key, title: key, module: key.split('.')[0]!.toUpperCase() }) as DocTypeInfo);

it('places every screen and document list an owner sees under a named sub-category', () => {
  const menu = buildMenu(DOC_TYPES, new Set(SCREENS.flatMap((s) => (s.permission ? [s.permission] : []))));
  const unplaced = menu.filter((g) => g.group !== 'Overview').flatMap((g) => g.items.filter((i) => subOf(i) === 'More').map((i) => `${g.group}: ${i.path}`));
  expect(unplaced).toEqual([]);
  const sales = menu.find((g) => g.group === 'Sales')!;
  expect(sectionsOf('Sales', sales.items).map((s) => s.sub)).toEqual(['Customers & quotes', 'Job orders & release', 'Collections', 'Shop & POS']);
  const placed = (path: string) => { const i = menu.flatMap((g) => g.items).find((x) => x.path === path); return i && subOf(i); };
  expect([placed('/docs/jo.release'), placed('/docs/col.cwt_only'), placed('/col/checks'), placed('/tax/sales'), placed('/tax/1702q'), placed('/acc/opening')])
    .toEqual(['Job orders & release', 'Collections', 'Cash & bank', 'Tax registers', 'Tax returns & payments', 'Setup']);
});

it("puts a group's sub-categories in the person's own order, then the usual one", () => {
  const menu = buildMenu(DOC_TYPES, new Set(SCREENS.flatMap((s) => (s.permission ? [s.permission] : []))));
  const sales = menu.find((g) => g.group === 'Sales')!;
  expect(sectionsOf('Sales', sales.items, ['Collections', 'Gone sub-category']).map((s) => s.sub)).toEqual(['Collections', 'Customers & quotes', 'Job orders & release', 'Shop & POS']);
});
