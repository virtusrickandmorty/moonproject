/**
 * The document engine contract (PLAN C4). A module declares its document types; the engine gives
 * them list/view/preview/post/cancel/reissue, numbering, audit, permissions and idempotency.
 *
 * CONTRACT FROZEN on day 1. Adding optional fields is fine; changing or removing fields needs
 * Claude #1 (Core & Ledger) to agree in a PR.
 */
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type fc from 'fast-check';
import type { Issue, PermissionDef } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import type { JournalDraft } from '../ledger/post.ts';
import type { SeriesDef } from '../numbering.ts';
import type { AppDeps } from '../../app.ts';

/** Print and screen titles must come from this list (PLAN H4, NR-14). Add new titles here in a PR. */
export const DOC_TITLES = [
  'Fund Transfer',
  'Cash Count',
  'Other Receipt',
  'Bank Adjustment',
  'Expense Voucher',
  'Journal Voucher',
  'Quotation',
  'Job Order',
  'Job Ticket',
  'Release Slip',
  'Production Entry',
  'Invoice Record',
  'Collection Receipt',
  'Acknowledgment Receipt',
  'Credit Memo',
  '2307 Received',
  'Deposit Forfeit',
  'Bad Debt Write-off',
  'Customer Refund',
  'Deposit Transfer',
  'Supplier Bill',
  'Supplier Payment',
  'Purchase Order',
  'Receiving Report',
  'Owner Money',
  'Officer Transaction',
  'Loan',
  'Loan Payment',
  'Fixed Asset',
  'Depreciation Run',
  'Asset Disposal',
  'Inventory Count',
  'Payroll Run',
  'Payroll Release',
  '13th-Month Pay',
  'Cash Advance',
  'Cash Advance Repayment',
  'Cash Advance Write-off',
  'Remittance',
  'VAT Close',
  'BIR Payment',
  'Opening Balances',
  // MIG-02 part 2: each module's opening document (key <module>.opening), dated the cut-over date (ACC/public.ts).
  'Opening Supplier Bill',
  'Opening Loan',
  'Opening Fixed Asset',
  'Opening Job Order',
  'Opening Cash Advance',
  'Opening Officer Balance',
  'Opening Withholding',
  'Opening Statutory Payable',
  'Opening Tax Payable',
] as const;
export type DocTitle = (typeof DOC_TITLES)[number];

/** What compute/validate/journal/summary may read. Read-only by convention: never write in these. */
export interface DocContext {
  db: Db;
  /** Business date the document will carry (Manila). */
  businessDate: string;
  /** Timestamp of this action, ISO with +08:00. */
  at: string;
  userId: string;
  can(permission: string): boolean;
}

export interface DocHeader {
  documentId: string;
  number: string;
  businessDate: string;
}

export interface DocTypeDef<Input = any, Doc extends { totalCents: number } = any> {
  /** Unique key, "<module lower>.<doc>", e.g. "cash.transfer". Used in URLs. */
  key: string;
  /** Module code that owns it, e.g. "CASH". */
  module: string;
  title: DocTitle;
  numbering: { series: SeriesDef };
  permissions: { view: string; create: string; post: string; cancel: string; print?: string };
  /** 'system' = always the server's Manila date (NR-7). */
  dating: 'system' | 'accountant_may_backdate';
  /**
   * The date of a cancel's mirror (NR-4, ACC-09): the cancel day (the default), or 'document_date' for a document that
   * states a balance as of its own date (opening balances on the cut-over date, an inventory count on a month end). Its
   * mirror then lands on that date, so the balance there is as if it had never been recorded, and an edit (cancel +
   * reissue on the same date) replaces it exactly. A mirror dated in the past is backdating: it needs acc.backdate.
   */
  cancelOn?: 'today' | 'document_date';
  /** zod schema with .strict(). Must NOT contain date, number, totals, status, user or VAT fields (NR-6). */
  inputSchema: z.ZodType<Input>;
  /** PURE. Totals, VAT, withholding and allocations in integer centavos. */
  compute(input: Input, ctx: DocContext): Doc;
  /** Business rules. Read-only DB access. Errors block posting; warnings are shown. */
  validate(doc: Doc, ctx: DocContext): Issue[];
  /** INSERT-only into the module's own tables. */
  persist(db: Db, doc: Doc, header: DocHeader): void;
  /**
   * PURE. Uses account role keys or user-picked master data, never hard-coded account ids. Omit for non-posting documents.
   * `header` is the document being posted (its id, number and date, after persist); a preview has none yet, so a line
   * that names the document itself (a receivable's `ref`) is left unnamed there.
   */
  journal?(doc: Doc, ctx: DocContext, header?: DocHeader): JournalDraft | null;
  /**
   * The number of the BIR paper form this document records (a sales invoice or collection receipt from an ATP
   * booklet). The engine stores it on documents.external_number, where the tax registers read it (PLAN E12).
   */
  externalNumber?(doc: Doc): string | null;
  /** Reads a posted document back from the module's tables. */
  load(db: Db, documentId: string): Doc;
  /** Turns a stored document back into form input (to prefill "Edit" = reissue). */
  toInput(doc: Doc): Input;
  /** Posted, not-cancelled documents that depend on this one (cancel is blocked while any exist). */
  dependents?(db: Db, documentId: string): { id: string; number: string }[];
  /** Moves children to the replacement during reissue. */
  relinkOnReissue?(db: Db, oldId: string, newId: string): void;
  /**
   * Runs in the cancel transaction after the mirror and the status change, also when cancelling for a reissue.
   * May insert into the module's own tables, like persist. A returned journal is posted in the same transaction with
   * source_type 'document-cancel' (PLAN D6: an invoice record's payments become deposits again; a collection whose
   * deposit an invoice already applied reopens the receivable). `header` carries the cancel date, user and time.
   */
  afterCancel?(db: Db, documentId: string, header: DocHeader & { userId: string; at: string }): JournalDraft | null;
  /** Plain English, e.g. "This will move ₱10,000.00 from BDO to China Bank." */
  summary(doc: Doc, ctx: DocContext): string;
  /** Random valid inputs for property tests (required, PLAN C4). */
  arbitrary(db: Db): fc.Arbitrary<Input>;
}

export interface ModuleDef {
  /** Module code, same as its folder name, e.g. "CASH". */
  code: string;
  name: string;
  permissions: PermissionDef[];
  docTypes: DocTypeDef[];
  /** Folder with this module's *.sql migrations. Tables must be prefixed with the lower-case code + "_". */
  migrationsDir?: string;
  /** Extra routes (lookups, reports). Every route must declare config.permission. */
  routes?(app: FastifyInstance, deps: AppDeps): void;
}

export function defineModule(m: ModuleDef): ModuleDef {
  for (const d of m.docTypes) {
    if (d.module !== m.code) throw new Error(`Doc type ${d.key} says module ${d.module} but lives in ${m.code}`);
    if (!d.key.startsWith(`${m.code.toLowerCase()}.`)) throw new Error(`Doc type key ${d.key} must start with ${m.code.toLowerCase()}.`);
  }
  return m;
}

export class Registry {
  readonly modules: ModuleDef[] = [];
  private readonly types = new Map<string, DocTypeDef>();

  add(m: ModuleDef): void {
    if (this.modules.some((x) => x.code === m.code)) throw new Error(`Module ${m.code} registered twice`);
    this.modules.push(m);
    for (const d of m.docTypes) {
      if (this.types.has(d.key)) throw new Error(`Doc type ${d.key} registered twice`);
      this.types.set(d.key, d);
    }
  }

  docType(key: string): DocTypeDef | undefined {
    return this.types.get(key);
  }

  docTypes(): DocTypeDef[] {
    return [...this.types.values()];
  }

  permissions(): (PermissionDef & { module: string })[] {
    return this.modules.flatMap((m) => m.permissions.map((p) => ({ ...p, module: m.code })));
  }
}
