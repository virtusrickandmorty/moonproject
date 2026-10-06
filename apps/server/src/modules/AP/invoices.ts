/**
 * One check for a supplier invoice recorded twice, shared by the supplier bill (AP) and the expense voucher (EXP).
 * Invoice numbers are compared as typed loosely: "SI-0042", "si 42" and "SI#00042" are the same invoice. The earlier
 * documents are the posted bills and posted vouchers of the same supplier: the same TIN when both have one, else the
 * same supplier on file, else (one-off payees with no TIN) the same payee name.
 */
import type { Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { BACKDATE_PERMISSION } from '../../engine/documents/lifecycle.ts';
import { postedVoucherInvoices } from '../EXP/public.ts';
import { supplier } from '../PUR/public.ts';

/** Upper case; no spaces, dashes, dots, slashes or "#"; no leading zeros in a run of digits. */
export function normalizeInvoiceNo(no: string): string {
  return no.toUpperCase().replace(/[\s\-./\\#]/g, '').replace(/\d+/g, (run) => run.replace(/^0+(?=\d)/, ''));
}

/** A TIN as digits, its branch code read as a number: 123-456-789-000 and 123-456-789-00000 are the same TIN. */
const tinKey = (tin: string) => {
  const d = tin.replace(/\D/g, '');
  return `${d.slice(0, 9)}:${Number(d.slice(9) || '0')}`;
};

/** Who issued the invoice: a supplier on file, its TIN, and the payee name for a one-off payee. */
export interface InvoiceParty { supplierId: string | null; tin: string | null; payeeName: string }

function sameParty(a: InvoiceParty, b: InvoiceParty): boolean {
  if (a.tin && b.tin) return tinKey(a.tin) === tinKey(b.tin);
  if (a.supplierId || b.supplierId) return a.supplierId === b.supplierId;
  return a.payeeName.trim().toLowerCase() === b.payeeName.trim().toLowerCase();
}

/** The number of the posted bill or voucher that already carries this invoice of this supplier, if any. */
export function earlierInvoice(db: Db, party: InvoiceParty, invoiceNo: string): string | undefined {
  const wanted = normalizeInvoiceNo(invoiceNo);
  if (!wanted) return undefined;
  const bills = db
    .prepare(
      `SELECT d.number, b.supplier_id AS supplierId, b.supplier_invoice_no AS invoiceNo FROM ap_bills b JOIN documents d ON d.id = b.document_id
       WHERE d.status = 'posted' ORDER BY d.posted_at, d.number`,
    )
    .all() as { number: string; supplierId: string; invoiceNo: string }[];
  const suppliers = new Map<string, InvoiceParty>();
  const supplierParty = (id: string) => {
    if (!suppliers.has(id)) {
      const s = supplier(db, id);
      suppliers.set(id, { supplierId: id, tin: s?.tin || null, payeeName: s?.name ?? '' });
    }
    return suppliers.get(id)!;
  };
  const earlier = [
    ...bills.filter((b) => normalizeInvoiceNo(b.invoiceNo) === wanted).map((b) => ({ number: b.number, party: supplierParty(b.supplierId) })),
    ...postedVoucherInvoices(db)
      .filter((v) => normalizeInvoiceNo(v.invoiceNo) === wanted)
      .map((v) => ({ number: v.number, party: { supplierId: v.supplierId, tin: v.payeeTin, payeeName: v.payeeName } })),
  ];
  return earlier.find((e) => sameParty(party, e.party))?.number;
}

/**
 * DUPLICATE_INVOICE when the invoice is already on a posted bill or voucher. Someone who may backdate (acc.backdate)
 * records it anyway by typing why (`reason`, stored on the document); then it is a warning.
 */
export function duplicateInvoiceIssues(
  db: Db, can: (permission: string) => boolean, party: InvoiceParty, invoiceNo: string | undefined, reason: string | undefined,
): Issue[] {
  const dup = invoiceNo ? earlierInvoice(db, party, invoiceNo) : undefined;
  if (!dup) return [];
  const said = `Invoice no. ${invoiceNo} of this supplier is already on ${dup}.`;
  if (reason && can(BACKDATE_PERMISSION)) return [{ field: 'duplicateReason', code: 'DUPLICATE_INVOICE', level: 'warning', message: `${said} Recorded again: ${reason}` }];
  return [{ field: 'supplierInvoiceNo', code: 'DUPLICATE_INVOICE', level: 'error', message: can(BACKDATE_PERMISSION) ? `${said} To record it again anyway, type why.` : said }];
}
