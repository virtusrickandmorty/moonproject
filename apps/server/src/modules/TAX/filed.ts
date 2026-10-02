/**
 * Filed periods (ACC-09, ACC-22): which BIR returns are filed, the filed-period warning every document gets, and the
 * "changes after filing" report. There is no lock (the owner's decision): recording or cancelling a document dated in a
 * filed period only warns, and the report lists what changed afterwards so the accountant can decide on an amendment.
 * A return counts as filed once a confirmation is registered or its payment is recorded and not cancelled. The earliest
 * standing record is the one that filed it:
 *   2550Q (BIRP-, the quarter, and the quarter's VAT close whatever its date), 0619-E (the month), 1601-EQ (the quarter),
 *   1601-FQ (the quarter), 1702Q (the quarter), 1702 (the year), and the 1601-C that a withholding-tax remittance pays (REM-, the month).
 * Only documents that post a journal count: a quotation or a purchase order changes no filed figure.
 */
import type { Db } from '../../platform/db/driver.ts';
import type { Issue } from '@moonproject/shared';
import type { NoticeTarget } from '../../engine/documents/registry.ts';
import { wtaxRemittances } from '../STAT/public.ts';
import { PAYMENT_ROWS, parsePeriod, type BirForm } from './payments.ts';
import { filedRegister, type FiledRegisterRow } from './filed-register.ts';

export type FiledForm = BirForm | '1601-C';

export interface FiledReturn {
  form: FiledForm;
  /** The return's period: 2026-07, 2026-Q3 or 2026. */
  period: string;
  /** In words: "July 2026", "July to September 2026", "2026". */
  label: string;
  from: string;
  to: string;
  /** The earliest standing source: a payment or a registered confirmation. */
  payment: { documentId: string; docType: string; number: string; paidOn: string; recordedAt: string } | null;
  register: FiledRegisterRow | null;
  recordedAt: string;
  reference: string;
  /** 2550Q only: the quarter's posted VAT close, which the return covers whatever its date. */
  vatCloseId: string | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A period in words, the way the warning names it. */
export function periodWords(period: string): string {
  const p = parsePeriod(period);
  if (!p) return period;
  if (p.kind === 'year') return String(p.year);
  if (p.kind === 'month') return p.label;
  return `${MONTHS[3 * p.quarter - 3]} to ${MONTHS[3 * p.quarter - 1]} ${p.year}`;
}

/** Every filed return, by when its earliest standing source was recorded. Audit order resolves a confirmation/payment tie. */
export function filedReturns(db: Db): FiledReturn[] {
  const bir = db
    .prepare(
      `SELECT p.form, p.period, d.id AS documentId, d.doc_type AS docType, d.number, d.business_date AS paidOn, d.posted_at AS recordedAt
       FROM ${PAYMENT_ROWS} p JOIN documents d ON d.id = p.document_id WHERE d.status = 'posted' ORDER BY d.posted_at, d.number`,
    )
    .all() as { form: BirForm; period: string; documentId: string; docType: string; number: string; paidOn: string; recordedAt: string }[];
  const sequence = db.prepare('SELECT seq FROM audit_log WHERE action = ? AND entity_type = ? AND entity_id = ? ORDER BY seq LIMIT 1').pluck();
  const sources = [
    ...bir.map(({ form, period, ...payment }) => ({ form: form as FiledForm, period, payment, register: null, recordedAt: payment.recordedAt, reference: payment.number })),
    ...wtaxRemittances(db).map((r) => ({
      form: '1601-C' as const, period: r.month,
      payment: { documentId: r.documentId, docType: 'stat.remittance', number: r.number, paidOn: r.paidOn, recordedAt: r.recordedAt },
      register: null, recordedAt: r.recordedAt, reference: r.number,
    })),
    ...filedRegister(db).filter((r) => !r.voidedAt).map((register) => ({
      form: register.form, period: register.period, payment: null, register, recordedAt: register.recordedAt, reference: register.reference,
    })),
  ].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)
    || Number(a.payment === null) - Number(b.payment === null)
    || (a.payment && b.payment ? a.payment.number.localeCompare(b.payment.number) : (a.register?.id ?? 0) - (b.register?.id ?? 0)));
  const closeOf = db.prepare(
    `SELECT c.document_id FROM tax_vat_closes c JOIN documents d ON d.id = c.document_id WHERE c.year = ? AND c.quarter = ? AND d.status = 'posted'`,
  );
  const out = new Map<string, FiledReturn>();
  for (const { form, period, payment, register, recordedAt, reference } of sources) {
    const key = `${form} ${period}`;
    const p = parsePeriod(period);
    if (!p) continue;
    const prior = out.get(key);
    if (prior) {
      // Payments retain their existing number ordering. Resolve a confirmation/payment timestamp tie only for this return,
      // so unrelated forms' payment numbers cannot interfere with which source was recorded first.
      if (!register || !prior.payment || recordedAt !== prior.recordedAt) continue;
      const registered = Number(sequence.get('tax.filed_return.add', 'tax_filed_return', String(register.id)) ?? 0);
      const paid = Number(sequence.get('document.post', prior.payment.docType, prior.payment.documentId) ?? 0);
      if (registered >= paid) continue;
    }
    const vatCloseId = form === '2550Q' ? ((closeOf.pluck().get(p.year, p.quarter) as string | undefined) ?? null) : null;
    out.set(key, { form, period, label: periodWords(period), from: p.from, to: p.to, payment, register, recordedAt, reference, vatCloseId });
  }
  return [...out.values()];
}

/** The filed returns that cover a date, with their earliest standing source. */
export function filedReturnsCovering(db: Db, date: string): FiledReturn[] {
  return filedReturns(db).filter((r) => r.from <= date && date <= r.to);
}

/** The returns a document being recorded or cancelled changes: its date is in their period, or it is a 2550Q's VAT close. */
function returnsTouched(db: Db, t: NoticeTarget): FiledReturn[] {
  const close = t.docType === 'tax.vat_close' && t.action === 'post' ? (t.doc as { year?: number; quarter?: number } | undefined) : undefined;
  return filedReturns(db).filter((r) => {
    if (r.payment && r.payment.documentId === t.documentId) return false; // cancelling the payment that filed it
    if (r.from <= t.businessDate && t.businessDate <= r.to) return true;
    if (r.form !== '2550Q') return false;
    return t.action === 'cancel' ? r.vatCloseId !== null && r.vatCloseId === t.documentId : !!close && r.period === `${close.year}-Q${close.quarter}`;
  });
}

const day = (at: string) => at.slice(0, 10); // stamps carry +08:00: the Manila day

/**
 * The FILED_PERIOD warning (a notice, run on every doc type after validate): names each return the document changes. It
 * never blocks: the owner chose a warning and the report over a lock (ACC-22).
 */
export function filedPeriodNotice(db: Db, t: NoticeTarget): Issue[] {
  if (!t.posts) return [];
  const touched = returnsTouched(db, t);
  if (!touched.length) return [];
  const named = touched.map((r) => r.payment
    ? `The ${r.form} for ${r.label} was paid on ${r.payment.number}, recorded ${day(r.recordedAt)}.`
    : `The ${r.form} for ${r.label} was filed on ${r.register!.filedOn}, reference ${r.reference}, recorded ${day(r.recordedAt)}.`).join(' ');
  const what = t.action === 'post'
    ? 'Recording this changes figures already filed'
    : 'Cancelling this changes figures already filed (its reversal is dated the day it is cancelled, but the filed return still shows the original)';
  return [{ field: 'businessDate', code: 'FILED_PERIOD', level: 'warning', message: `${named} ${what}; tell the accountant, who may need to amend the return.` }];
}

export interface ChangeAfterFiling {
  /** The document's own date, inside the return's period. */
  date: string;
  documentId: string; docType: string; number: string;
  what: 'recorded' | 'cancelled';
  userId: string; userName: string;
  /** When it was recorded or cancelled, after the filing source was recorded. */
  at: string;
  form: FiledForm; period: string; periodLabel: string; paymentNumber: string; paymentRecordedAt: string;
}

/**
 * ACC-22 "changes after filing": documents dated in a filed period (or a filed 2550Q's VAT close) that were recorded or
 * cancelled after that return's filing source was recorded, oldest change first. A document recorded and later cancelled
 * shows twice.
 */
export function changesAfterFiling(db: Db): ChangeAfterFiling[] {
  const docs = db.prepare(
    `SELECT d.id, d.doc_type AS docType, d.number, d.business_date AS date, d.posted_at AS postedAt, d.posted_by AS postedBy,
       d.cancelled_at AS cancelledAt, d.cancelled_by AS cancelledBy
     FROM documents d
     WHERE ((d.business_date BETWEEN @from AND @to) OR d.id = @close) AND d.id <> @payment
       AND (d.posted_at > @at OR d.cancelled_at > @at)
       AND EXISTS (SELECT 1 FROM journals j WHERE j.source_type = 'document' AND j.source_id = d.id)`,
  );
  const nameOf = db.prepare('SELECT display_name FROM users WHERE id = ?').pluck();
  const names = new Map<string, string>();
  const name = (id: string) => names.get(id) ?? (names.set(id, (nameOf.get(id) as string | undefined) ?? '?'), names.get(id)!);
  const out: ChangeAfterFiling[] = [];
  for (const r of filedReturns(db)) {
    const rows = docs.all({ from: r.from, to: r.to, close: r.vatCloseId, payment: r.payment?.documentId ?? '', at: r.recordedAt }) as {
      id: string; docType: string; number: string; date: string; postedAt: string; postedBy: string; cancelledAt: string | null; cancelledBy: string | null;
    }[];
    const base = { form: r.form, period: r.period, periodLabel: r.label, paymentNumber: r.reference, paymentRecordedAt: r.recordedAt };
    for (const d of rows) {
      const doc = { date: d.date, documentId: d.id, docType: d.docType, number: d.number };
      if (d.postedAt > r.recordedAt) out.push({ ...doc, what: 'recorded', userId: d.postedBy, userName: name(d.postedBy), at: d.postedAt, ...base });
      if (d.cancelledAt && d.cancelledBy && d.cancelledAt > r.recordedAt) {
        out.push({ ...doc, what: 'cancelled', userId: d.cancelledBy, userName: name(d.cancelledBy), at: d.cancelledAt, ...base });
      }
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.number.localeCompare(b.number) || a.form.localeCompare(b.form));
}
