/**
 * The statement of account as an HTML attachment (PLAN E14), rendered like a print: the company's registered name, the
 * plain title, the input-tax legend (C9 / H4) and escaped text. Lines are described in plain words by the kind of
 * document, never by the journal memo (which can carry booklet wording such as an invoice number).
 */
import { formatPeso } from '@moonproject/shared';
import type { customerStatement } from '../RPT/receivables.ts';
import { plain } from './text.ts';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const WORDS: Record<string, string> = {
  'jo.invoice_record': 'Sale', 'jo.dp_invoice': 'Downpayment billed', 'jo.opening': 'Brought forward', 'col.collection': 'Payment received',
  'col.credit_memo': 'Credit', 'col.write_off': 'Written off', 'col.refund': 'Refund', 'col.deposit_transfer': 'Deposit moved', 'col.cwt_only': 'Tax withheld',
};

export type Statement = NonNullable<ReturnType<typeof customerStatement>>;

export function renderStatementHtml(statement: Statement, company: { registeredName: string }, madeAt: string): string {
  const row = (cells: unknown[], tag = 'td') => `<tr>${cells.map((c, i) => `<${tag}${i >= 3 ? ' class="n"' : ''}>${escape(c)}</${tag}>`).join('')}</tr>`;
  const lines = [
    row(['', 'Balance brought forward', '', '', '', formatPeso(statement.openingBalanceCents)]),
    ...statement.lines.map((l) => row([l.businessDate, l.documentNumber ?? '', WORDS[l.documentType ?? ''] ?? 'Adjustment',
      l.debitCents ? formatPeso(l.debitCents) : '', l.creditCents ? formatPeso(l.creditCents) : '', formatPeso(l.runningBalanceCents)])),
    row(['', 'Balance you owe us', '', '', '', formatPeso(statement.closingBalanceCents)]),
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>STATEMENT OF ACCOUNT</title><style>
body{font:11pt Arial,sans-serif;color:#111;margin:12mm}h1{font-size:18pt;margin:6mm 0 1mm}header{text-align:center}.legend{font-size:9pt;font-weight:bold}
table{width:100%;border-collapse:collapse;margin:4mm 0}th,td{border:1px solid #aaa;padding:1.5mm;text-align:left}th{background:#eee}.n{text-align:right}footer{font-size:9pt;color:#555}
</style></head><body><header><strong>${escape(company.registeredName)}</strong><h1>STATEMENT OF ACCOUNT</h1>
<p class="legend">THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</p></header>
<p><b>Customer:</b> ${escape(plain(statement.customerName))}<br><b>From:</b> ${escape(statement.from)} <b>to:</b> ${escape(statement.to)}</p>
<table><thead>${row(['Date', 'Document no.', 'What', 'We billed', 'You paid or were credited', 'Balance'], 'th')}</thead><tbody>${lines.join('')}</tbody></table>
<p><b>Deposits we are holding for you on ${escape(statement.to)}:</b> ${escape(formatPeso(statement.depositsHeldCents))}</p>
<footer>Made ${escape(madeAt)}. If anything here does not match your records, please tell us.</footer></body></html>`;
}
