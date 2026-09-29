/**
 * Output VAT on uncollected receivables: the claim (UVAT-) and the add-back (UVATR-). The rule, the requisites and
 * what the books can check are in ../uncollected-vat.ts.
 *   UVAT-:  Dr 2301 output VAT (party the customer) / Cr 2303 output VAT deferred (party the customer, ref the invoice)
 *   UVATR-: Dr 2303 (party the customer, ref the invoice) / Cr 2301 (party the customer)
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { settingAt } from '../../../engine/settings.ts';
import { customerTaxInfo } from '../../CUS/public.ts';
import { invoiceRecordRef, invoiceRecordsOf } from '../../JO/public.ts';
import { quarterOf } from '../calendar.ts';
import {
  CLAIMS, FIRST_SALE_DATE, addBackOf, claim, claimOn, invoiceFacts, invoiceWords, nextQuarterStart, paidSince, quarterKey, vatShare, type ClaimRow,
} from '../uncollected-vat.ts';

const CONFIRMS = {
  writtenAgreement: 'a written agreement sets the time to pay',
  listedInSlsp: 'the sale is listed on its own in the SLSP',
  declaredOnTime: 'its output VAT was declared on time in a filed 2550Q',
  notBadDebt: 'this VAT is not claimed as part of a bad debt deduction',
} as const;
type Confirm = keyof typeof CONFIRMS;

export const uncollectedVatInput = z
  .object({
    invoiceId: z.string().trim().min(1).max(80),
    writtenAgreement: z.boolean(),
    listedInSlsp: z.boolean(),
    declaredOnTime: z.boolean(),
    notBadDebt: z.boolean(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type UncollectedVatInput = z.infer<typeof uncollectedVatInput>;

export interface UncollectedVat extends UncollectedVatInput {
  totalCents: number; vatCents: number;
  invoice: { number: string; invoiceNumber: string; jobOrderNumber: string; status: string; date: string; dueDate: string | null; customerId: string; customerName: string;
    grossCents: number; vatCents: number; depositAppliedCents: number; owedCents: number; creditedCents: number } | null;
}

export const uncollectedVatDoc: DocTypeDef<UncollectedVatInput, UncollectedVat> = {
  key: 'tax.uncollected_vat',
  module: 'TAX',
  title: 'VAT on Uncollected Receivable',
  numbering: { series: { key: 'UVAT', prefix: 'UVAT-' } },
  permissions: { view: 'tax.uncollected.view', create: 'tax.uncollected.post', post: 'tax.uncollected.post', cancel: 'tax.uncollected.cancel' },
  dating: 'system',
  inputSchema: uncollectedVatInput,

  compute(input, ctx) {
    const f = invoiceFacts(ctx.db, input.invoiceId, ctx.businessDate);
    const vatCents = f && f.status === 'posted' ? vatShare(f.vatCents, f.owedCents, f.grossCents) : 0;
    const invoice = f && {
      number: f.number, invoiceNumber: f.invoiceNumber, jobOrderNumber: f.jobOrderNumber, status: f.status, date: f.businessDate, dueDate: f.dueDate,
      customerId: f.customerId, customerName: f.customerName, grossCents: f.grossCents, vatCents: f.vatCents, depositAppliedCents: f.depositAppliedCents,
      owedCents: f.owedCents, creditedCents: f.creditedCents,
    };
    return { ...input, invoice: invoice ?? null, vatCents, totalCents: vatCents };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    if (!settingAt(ctx.db, 'tax.uncollected_vat_credit', ctx.businessDate)) {
      add('error', 'invoiceId', 'SETTING_OFF', 'Claiming output VAT on uncollected receivables is off. The accountant turns it on in the settings (ACC-26).');
    }
    const f = invoiceFacts(ctx.db, doc.invoiceId, ctx.businessDate);
    if (!f) {
      add('error', 'invoiceId', 'INVOICE', 'Pick a release invoice record (IR-). A quick sale is paid on the spot, so it has no agreed time to pay.');
      return issues;
    }
    const words = invoiceWords(f);
    if (f.status !== 'posted') add('error', 'invoiceId', 'INVOICE_CANCELLED', `${words} was cancelled.`);
    const claimed = claimOn(ctx.db, f.id);
    if (claimed) add('error', 'invoiceId', 'CLAIMED_ALREADY', `The output VAT of ${words} is already claimed on ${claimed.number}.`);
    // (1) the sale date
    if (f.businessDate < FIRST_SALE_DATE) add('error', 'invoiceId', 'SALE_BEFORE_EOPT', `${words} is dated ${f.businessDate}: only sales after 27 April 2024 qualify.`);
    // (2) a credit sale: a due date after the invoice date, and a receivable left after the deposits it applied
    if (!f.dueDate || f.dueDate <= f.businessDate || f.grossCents - f.depositAppliedCents <= 0) {
      add('error', 'invoiceId', 'NOT_ON_CREDIT', `${words} was not a sale on credit: it has no agreed time to pay after its date.`);
    }
    // (4) VAT on the invoice
    if (f.vatCents <= 0) add('error', 'invoiceId', 'NO_VAT_SHOWN', `${words} shows no VAT, so there is none to claim.`);
    // (6) declared: the invoice's quarter was closed after the invoice was recorded (the close is prepared with the 2550Q)
    const q = quarterOf(f.businessDate);
    if (!f.close) add('error', 'invoiceId', 'NOT_DECLARED', `Q${q.quarter} ${q.year} has no VAT close, so ${words} was not declared in a 2550Q yet.`);
    else if (f.recordedAt > f.close.recordedAt) {
      add('error', 'invoiceId', 'NOT_DECLARED', `${words} was recorded after Q${q.quarter} ${q.year} was closed (${f.close.number}): its VAT was not declared on that 2550Q.`);
    } else if (f.close.recordedOn > f.returnDue) {
      add('warning', 'invoiceId', 'CLOSED_LATE', `${f.close.number} was recorded after the 2550Q was due (${f.returnDue}). Check that the return itself was filed on time.`);
    }
    // (7) the agreed time has passed, and this is a later quarter
    if (f.dueDate && quarterKey(ctx.businessDate) <= quarterKey(f.dueDate)) {
      add('error', 'invoiceId', 'TIME_TO_PAY', `The time to pay ${words} ends on ${f.dueDate}. The VAT is claimed in the quarter after that, from ${nextQuarterStart(f.dueDate)}.`);
    } else if (f.dueDate && quarterKey(ctx.businessDate) > quarterKey(f.dueDate) + 1) {
      add('warning', 'invoiceId', 'LATER_QUARTER', `The time to pay ended on ${f.dueDate}, more than a quarter ago: the rule says the quarter after. The accountant decides.`);
    }
    // (8) in part: not written off
    if (f.writeOffs.length > 0) add('error', 'invoiceId', 'WRITTEN_OFF', `${words} was written off as a bad debt (${f.writeOffs.join(', ')}).`);
    if (f.status === 'posted' && f.owedCents === 0) add('error', 'invoiceId', 'NOTHING_OWED', `${words} owes nothing, so there is no uncollected VAT.`);
    for (const k of Object.keys(CONFIRMS) as Confirm[]) {
      if (!doc[k]) add('error', k, 'CONFIRM', `Confirm that ${CONFIRMS[k]}: the books cannot tell.`);
    }
    if (!customerTaxInfo(ctx.db, f.customerId)?.tin) {
      add('warning', 'listedInSlsp', 'NO_TIN', `${f.customerName} has no TIN on file, so the SLSP put the sale on the line without a TIN, not on its own.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    const i = doc.invoice!;
    db.prepare(
      `INSERT INTO tax_uncollected_vat (document_id, invoice_id, customer_id, invoice_date, due_date, gross_cents, invoice_vat_cents, owed_cents, credited_cents, vat_cents,
         written_agreement, listed_in_slsp, declared_on_time, not_bad_debt, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.invoiceId, i.customerId, i.date, i.dueDate, i.grossCents, i.vatCents, i.owedCents, i.creditedCents, doc.vatCents,
      +doc.writtenAgreement, +doc.listedInSlsp, +doc.declaredOnTime, +doc.notBadDebt, doc.note ?? null);
  },

  journal(doc) {
    const i = doc.invoice!;
    const party = { type: 'customer', id: i.customerId };
    const memo = `Output VAT on uncollected ${invoiceWords(i)}, due ${i.dueDate}`;
    return {
      memo,
      lines: [
        { account: { role: 'OUTPUT_VAT' }, party, debitCents: doc.vatCents, memo },
        { account: { role: 'OUTPUT_VAT_DEFERRED' }, party, ref: { documentId: doc.invoiceId }, creditCents: doc.vatCents, memo },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM tax_uncollected_vat WHERE document_id = ?').get(documentId) as Record<string, string | number | null> | undefined;
    if (!r) throw new Error(`Uncollected VAT claim ${documentId} not found`);
    const inv = invoiceRecordRef(db, r.invoice_id as string)!;
    const n = (k: string) => r[k] as number;
    return {
      invoiceId: inv.id, writtenAgreement: true, listedInSlsp: true, declaredOnTime: true, notBadDebt: true, ...(r.note ? { note: r.note as string } : {}),
      invoice: {
        number: inv.number, invoiceNumber: inv.invoiceNumber, jobOrderNumber: inv.jobOrderNumber, status: inv.status, date: r.invoice_date as string, dueDate: r.due_date as string,
        customerId: r.customer_id as string, customerName: inv.customerName, grossCents: n('gross_cents'), vatCents: n('invoice_vat_cents'), depositAppliedCents: inv.depositAppliedCents,
        owedCents: n('owed_cents'), creditedCents: n('credited_cents'),
      },
      vatCents: n('vat_cents'), totalCents: n('vat_cents'),
    };
  },

  toInput: ({ invoiceId, writtenAgreement, listedInSlsp, declaredOnTime, notBadDebt, note }) =>
    ({ invoiceId, writtenAgreement, listedInSlsp, declaredOnTime, notBadDebt, ...(note ? { note } : {}) }),

  /** An add-back of this claim: cancel it first. */
  dependents: (db, documentId) =>
    db.prepare(`SELECT d.id, d.number FROM tax_uncollected_vat_recoveries r JOIN documents d ON d.id = r.document_id WHERE r.claim_id = ? AND d.status = 'posted' ORDER BY d.number`)
      .all(documentId) as { id: string; number: string }[],

  summary(doc) {
    const i = doc.invoice;
    if (!i) return 'Pick the invoice whose output VAT is still uncollected.';
    return `This will take ${formatPeso(doc.vatCents)} output VAT off this quarter's 2550Q for ${invoiceWords(i)} of ${i.customerName}: ${formatPeso(i.owedCents)} of ${formatPeso(i.grossCents)} `
      + `is still owed after the agreed time to pay ended on ${i.dueDate}. It is added back when the customer pays.`;
  },

  /** Needs a release invoice that still owes: its claim, the four confirmations given. */
  arbitrary(db) {
    const open = invoiceRecordsOf(db, 'all').map((i) => i.id);
    if (open.length === 0) throw new Error('tax.uncollected_vat.arbitrary needs a recorded release invoice');
    return fc.record({ invoiceId: fc.constantFrom(...open), note: fc.constantFrom(undefined, 'Customer asked for more time') }).map(({ note, ...r }) => ({
      ...r, writtenAgreement: true, listedInSlsp: true, declaredOnTime: true, notBadDebt: true, ...(note ? { note } : {}),
    }));
  },
};

export const uncollectedVatRecoveryInput = z
  .object({ claimId: z.string().trim().min(1).max(80), note: z.string().trim().min(1).max(500).optional() })
  .strict();
export type UncollectedVatRecoveryInput = z.infer<typeof uncollectedVatRecoveryInput>;

export interface UncollectedVatRecovery extends UncollectedVatRecoveryInput {
  totalCents: number; vatCents: number;
  claim: { number: string; invoiceId: string; customerId: string; customerName: string; invoiceNumber: string; invoiceRecordNumber: string; jobOrderNumber: string;
    vatCents: number; addedBackCents: number; owedAtClaimCents: number } | null;
  paidCents: number; owedCents: number; creditedCents: number; creditedSinceCents: number;
}

export const uncollectedVatRecoveryDoc: DocTypeDef<UncollectedVatRecoveryInput, UncollectedVatRecovery> = {
  key: 'tax.uncollected_vat_recovery',
  module: 'TAX',
  title: 'VAT on Recovered Receivable',
  numbering: { series: { key: 'UVATR', prefix: 'UVATR-' } },
  permissions: { view: 'tax.uncollected.view', create: 'tax.uncollected.post', post: 'tax.uncollected.post', cancel: 'tax.uncollected.cancel' },
  dating: 'system',
  inputSchema: uncollectedVatRecoveryInput,

  compute(input, ctx) {
    const c = claim(ctx.db, input.claimId);
    if (!c) return { ...input, claim: null, paidCents: 0, owedCents: 0, creditedCents: 0, creditedSinceCents: 0, vatCents: 0, totalCents: 0 };
    const a = addBackOf(ctx.db, c, ctx.businessDate);
    return {
      ...input,
      claim: {
        number: c.number, invoiceId: c.invoiceId, customerId: c.customerId, customerName: a.facts.customerName, invoiceNumber: a.facts.invoiceNumber,
        invoiceRecordNumber: a.facts.number, jobOrderNumber: a.facts.jobOrderNumber, vatCents: c.vatCents, addedBackCents: c.addedBackCents, owedAtClaimCents: c.owedCents,
      },
      paidCents: a.paidCents, owedCents: a.facts.owedCents, creditedCents: a.facts.creditedCents, creditedSinceCents: a.creditedSinceCents, vatCents: a.vatCents, totalCents: a.vatCents,
    };
  },

  validate(doc) {
    const issues: Issue[] = [];
    const c = doc.claim;
    if (!c) return [{ field: 'claimId', code: 'CLAIM', level: 'error', message: 'Pick a recorded claim of output VAT on an uncollected receivable (UVAT-).' }];
    if (doc.vatCents <= 0) {
      issues.push({ field: 'claimId', code: 'NOTHING_PAID', level: 'error', message: `Nothing was paid on invoice no. ${c.invoiceNumber} since ${c.number} (beyond what was added back), so there is no VAT to add back.` });
    }
    if (doc.creditedSinceCents > 0) {
      issues.push({ field: 'claimId', code: 'CREDITED_SINCE', level: 'warning',
        message: `${formatPeso(doc.creditedSinceCents)} was credited on the invoice since ${c.number} (credit memo, write-off or 2307): that is no payment, so its VAT stays deferred. The accountant decides what to do with it.` });
    }
    return issues;
  },

  persist(db, doc, h) {
    const c = doc.claim!;
    db.prepare('INSERT INTO tax_uncollected_vat_recoveries (document_id, claim_id, invoice_id, customer_id, owed_cents, credited_cents, vat_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(h.documentId, doc.claimId, c.invoiceId, c.customerId, doc.owedCents, doc.creditedCents, doc.vatCents, doc.note ?? null);
  },

  journal(doc) {
    const c = doc.claim!;
    const party = { type: 'customer', id: c.customerId };
    const memo = `Output VAT of ${c.number} added back: invoice no. ${c.invoiceNumber} paid`;
    return {
      memo,
      lines: [
        { account: { role: 'OUTPUT_VAT_DEFERRED' }, party, ref: { documentId: c.invoiceId }, debitCents: doc.vatCents, memo },
        { account: { role: 'OUTPUT_VAT' }, party, creditCents: doc.vatCents, memo },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT claim_id AS claimId, owed_cents AS owedCents, credited_cents AS creditedCents, vat_cents AS vatCents, note FROM tax_uncollected_vat_recoveries WHERE document_id = ?')
      .get(documentId) as { claimId: string; owedCents: number; creditedCents: number; vatCents: number; note: string | null } | undefined;
    if (!r) throw new Error(`Uncollected VAT add-back ${documentId} not found`);
    const c = db.prepare(`${CLAIMS.replace("WHERE d.status = 'posted'", 'WHERE 1')} AND d.id = @id`).get({ id: r.claimId, except: documentId }) as ClaimRow;
    const inv = invoiceRecordRef(db, c.invoiceId)!;
    return {
      claimId: r.claimId, ...(r.note ? { note: r.note } : {}),
      claim: {
        number: c.number, invoiceId: c.invoiceId, customerId: c.customerId, customerName: inv.customerName, invoiceNumber: inv.invoiceNumber, invoiceRecordNumber: inv.number,
        jobOrderNumber: inv.jobOrderNumber, vatCents: c.vatCents, addedBackCents: c.addedBackCents, owedAtClaimCents: c.owedCents,
      },
      ...paidSince(c, r.owedCents, r.creditedCents), owedCents: r.owedCents, creditedCents: r.creditedCents,
      vatCents: r.vatCents, totalCents: r.vatCents,
    };
  },

  toInput: ({ claimId, note }) => ({ claimId, ...(note ? { note } : {}) }),

  summary(doc) {
    const c = doc.claim;
    if (!c) return 'Pick the claim whose customer has paid.';
    return `This will add ${formatPeso(doc.vatCents)} output VAT back to this quarter's 2550Q: ${c.customerName} paid ${formatPeso(doc.paidCents)} on invoice no. ${c.invoiceNumber} `
      + `(${c.invoiceRecordNumber}) since its output VAT was claimed on ${c.number}.`;
  },

  arbitrary(db) {
    const claims = (db.prepare(`${CLAIMS} ORDER BY d.number`).all({ except: '' }) as ClaimRow[]).map((c) => c.documentId);
    if (claims.length === 0) throw new Error('tax.uncollected_vat_recovery.arbitrary needs a recorded claim');
    return fc.constantFrom(...claims).map((claimId) => ({ claimId }));
  },
};
