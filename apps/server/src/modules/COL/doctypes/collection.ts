/**
 * Collection (PLAN E5, D5 DEP-RCV / COL-RCV / COL-OVER): money in from a customer, split across cash places and
 * applied to job orders, in one journal.
 *   Dr cash place (per tender); Dr 1410 CWT (2307); Dr 6280 (short ≤ ₱1)
 *     / Cr 1201 AR (the JO's invoiced part); Cr 2201 (the JO's un-invoiced part, a deposit);
 *       Cr 2201 (unapplied remainder, no JO); Cr 6280 (over ≤ ₱1)
 * AR and deposit lines name the customer and the JO (journal_lines.ref_doc_id), so each JO's balance due is read
 * from the ledger (JO public.ts). Balance rule (E5): Σ tenders + CWT = Σ applied + unapplied, give or take ₱1.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, applyRate, formatPeso, vatFromGross, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { listCashPlaces } from '../../../engine/ledger/accounts.ts';
import { customerRef } from '../../CUS/public.ts';
import { jobOrderRef, jobOrdersOf, joLedger, joMoney } from '../../JO/public.ts';
import { MAX_CENTS, cashPlaceIssues, depositsHeld, insertTenders, loadTenders, sumCents, tenderInput, tenderToInput, withNames, type Tender } from '../ledger.ts';

/** Largest difference that may go to cash short and over instead of a deposit or an unpaid balance (D4.9). */
export const SHORT_OVER_LIMIT_CENTS = 100;
/** For the expected-CWT warning only, until the effective-dated VAT rate setting (ACC) exists. */
const VAT_BP = 1200;
/** Expected customer CWT by ATC (D4.6): WC158 goods 1%, WC160 services 2%. "other" has no expectation. */
const CWT_BP = { WC158: 100, WC160: 200 } as const;

const application = z.object({ jobOrderId: z.uuid(), amountCents: z.number().int().positive().max(MAX_CENTS) }).strict();

export const collectionInput = z
  .object({
    customerId: z.uuid(),
    // Typed from the ATP CR booklet, never prefilled (ACC-03 booklet mode).
    crNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the CR (digits only).'),
    applications: z.array(application).max(50),
    tenders: z.array(tenderInput).min(1).max(10),
    withholding: z
      .object({ cwtCents: z.number().int().positive().max(MAX_CENTS), atc: z.enum(['WC158', 'WC160', 'other']), certificate: z.enum(['pending', 'received']) })
      .strict()
      .optional(),
    settleSmallDifference: z.boolean().optional(), // a difference up to ₱1.00 goes to cash short and over (D4.9)
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type CollectionInput = z.infer<typeof collectionInput>;

export interface Application extends z.infer<typeof application> { lineNo: number; jobOrderNumber: string; toReceivableCents: number; toDepositCents: number }
export interface Collection extends Omit<CollectionInput, 'applications' | 'tenders'> {
  applications: Application[];
  tenders: Tender[];
  customerName: string;
  cwtCents: number;
  appliedCents: number;
  unappliedCents: number;
  /** + over (kept), − short (absorbed). */
  shortOverCents: number;
  totalCents: number;
}

function crUsedBy(db: Db, crNumber: string) {
  return db
    .prepare(`SELECT d.number, d.status FROM col_collections c JOIN documents d ON d.id = c.document_id WHERE CAST(c.cr_number AS INTEGER) = CAST(? AS INTEGER)`)
    .get(crNumber) as { number: string; status: string } | undefined;
}

export const collectionDoc: DocTypeDef<CollectionInput, Collection> = {
  key: 'col.collection',
  module: 'COL',
  title: 'Collection Receipt',
  numbering: { series: { key: 'COL', prefix: 'COL-' } },
  permissions: { view: 'col.view', create: 'col.create', post: 'col.post', cancel: 'col.cancel' },
  dating: 'system',
  inputSchema: collectionInput,

  compute(input, ctx) {
    const { settleSmallDifference, ...rest } = input;
    const cwtCents = input.withholding?.cwtCents ?? 0;
    const totalCents = sumCents(input.tenders) + cwtCents;
    // The JO's open receivable is settled first; what is left is a deposit on the JO's un-invoiced part (D3).
    const applications = input.applications.map((a, i) => {
      const jo = jobOrderRef(ctx.db, a.jobOrderId);
      const toReceivableCents = Math.min(a.amountCents, jo ? Math.max(0, joLedger(ctx.db, jo.id).receivableCents) : 0);
      return { ...a, lineNo: i + 1, jobOrderNumber: jo?.number ?? '?', toReceivableCents, toDepositCents: a.amountCents - toReceivableCents };
    });
    const appliedCents = sumCents(applications);
    const difference = totalCents - appliedCents;
    return {
      ...rest,
      ...(settleSmallDifference ? { settleSmallDifference } : {}),
      applications,
      tenders: withNames(ctx.db, input.tenders),
      customerName: customerRef(ctx.db, input.customerId)?.display_name ?? '?',
      cwtCents,
      appliedCents,
      unappliedCents: settleSmallDifference ? 0 : Math.max(0, difference),
      shortOverCents: settleSmallDifference ? difference : 0,
      totalCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const c = customerRef(ctx.db, doc.customerId);
    if (c?.is_active !== 1) add('error', 'customerId', 'CUSTOMER', c ? `${c.display_name} is inactive. Pick an active customer.` : 'Pick a customer.');
    const used = crUsedBy(ctx.db, doc.crNumber);
    if (used) {
      const how = used.status === 'cancelled' ? ' (cancelled)' : '';
      add('error', 'crNumber', 'CR_USED', `CR ${doc.crNumber} is already used on ${used.number}${how}. Each CR number is used once: write this payment on a new CR and keep all copies of a spoiled one.`);
    }
    issues.push(...cashPlaceIssues(ctx.db, doc.tenders, 'Pick where the money went.'));
    if (doc.totalCents > MAX_CENTS) add('error', 'tenders', 'TOO_BIG', 'The amount is over ₱100 million. Please check the amounts.');

    const seen = new Set<string>();
    for (const a of doc.applications) {
      const f = `applications.${a.lineNo - 1}`;
      const jo = jobOrderRef(ctx.db, a.jobOrderId);
      if (!jo || jo.customerId !== doc.customerId) {
        add('error', `${f}.jobOrderId`, 'JOB_ORDER', `Line ${a.lineNo}: pick one of ${doc.customerName}'s job orders.`);
      } else if (seen.has(jo.id)) {
        add('error', `${f}.jobOrderId`, 'JO_TWICE', `${jo.number} is listed twice. Put its whole amount on one line.`);
      } else if (jo.status !== 'posted') {
        add('error', `${f}.jobOrderId`, 'JO_CANCELLED', `${jo.number} is cancelled, so money cannot be applied to it.`);
      } else {
        const due = joMoney(ctx.db, jo.id).balanceDueCents;
        if (a.amountCents > due) {
          add('error', `${f}.amountCents`, 'OVER_BALANCE', due > 0 ? `${jo.number} has ${formatPeso(due)} left to pay. Apply at most that; the rest is kept as a deposit.` : `${jo.number} is fully paid.`);
        }
      }
      seen.add(a.jobOrderId);
    }

    const difference = doc.totalCents - doc.appliedCents;
    if (doc.settleSmallDifference) {
      if (Math.abs(difference) > SHORT_OVER_LIMIT_CENTS) {
        add('error', 'settleSmallDifference', 'DIFFERENCE_TOO_BIG', `Only a difference of up to ₱1.00 can go to cash short and over. This one is ${formatPeso(Math.abs(difference))}.`);
      }
    } else if (difference < 0) {
      add('error', 'applications', 'APPLIED_MORE', `You applied ${formatPeso(doc.appliedCents)} but received ${formatPeso(doc.totalCents)} (money plus tax withheld).`);
    }
    if (doc.unappliedCents > 0) {
      add('warning', 'applications', 'UNAPPLIED', `${formatPeso(doc.unappliedCents)} is not applied to a job order. It is kept as ${doc.customerName}'s deposit, to apply or refund later.`);
    }
    const w = doc.withholding;
    if (w && w.atc !== 'other') {
      const expected = applyRate(vatFromGross(doc.totalCents, VAT_BP).netCents, CWT_BP[w.atc]);
      if (Math.abs(w.cwtCents - expected) > 100) {
        add('warning', 'withholding.cwtCents', 'CWT_EXPECTED', `Tax withheld under ${w.atc} is usually ${formatPeso(expected)} on this payment. Please check the 2307.`);
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    const w = doc.withholding;
    db.prepare(
      `INSERT INTO col_collections (document_id, customer_id, customer_name, cr_number, cwt_cents, cwt_atc, cert_2307, unapplied_cents, short_over_cents, settle_small_difference, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.customerId, doc.customerName, doc.crNumber, doc.cwtCents, w?.atc ?? null, w?.certificate ?? null, doc.unappliedCents, doc.shortOverCents, doc.settleSmallDifference ? 1 : 0, doc.note ?? null);
    insertTenders(db, 'col_tenders', h.documentId, doc.tenders);
    const app = db.prepare(
      'INSERT INTO col_applications (document_id, line_no, job_order_id, amount_cents, to_receivable_cents, to_deposit_cents) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const a of doc.applications) app.run(h.documentId, a.lineNo, a.jobOrderId, a.amountCents, a.toReceivableCents, a.toDepositCents);
  },

  journal(doc) {
    const party = { type: 'customer', id: doc.customerId };
    return {
      memo: `Collection from ${doc.customerName}, CR ${doc.crNumber}`,
      lines: [
        ...doc.tenders.map((t) => ({ account: { cashPlace: t.cashPlaceId }, debitCents: t.amountCents, ...(t.reference ? { memo: t.reference } : {}) })),
        { account: { role: 'CWT' }, party, debitCents: doc.cwtCents, memo: `2307 ${doc.withholding?.atc ?? ''}`.trim() },
        { account: { role: 'CASH_SHORT_OVER' }, debitCents: Math.max(0, -doc.shortOverCents), memo: 'Short' },
        ...doc.applications.flatMap((a) => [
          { account: { role: 'AR_TRADE' }, party, ref: { documentId: a.jobOrderId }, creditCents: a.toReceivableCents, memo: a.jobOrderNumber },
          { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref: { documentId: a.jobOrderId }, creditCents: a.toDepositCents, memo: `Deposit for ${a.jobOrderNumber}` },
        ]),
        { account: { role: 'CUSTOMER_DEPOSITS' }, party, creditCents: doc.unappliedCents, memo: 'Unapplied payment' },
        { account: { role: 'CASH_SHORT_OVER' }, creditCents: Math.max(0, doc.shortOverCents), memo: 'Over' },
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare(`SELECT c.*, d.total_cents FROM col_collections c JOIN documents d ON d.id = c.document_id WHERE c.document_id = ?`)
      .get(documentId) as
      | { customer_id: string; customer_name: string; cr_number: string; cwt_cents: number; cwt_atc: 'WC158' | 'WC160' | 'other' | null; cert_2307: 'pending' | 'received' | null;
          unapplied_cents: number; short_over_cents: number; settle_small_difference: number; note: string | null; total_cents: number }
      | undefined;
    if (!r) throw new Error(`Collection ${documentId} not found`);
    const applications = (
      db
        .prepare('SELECT line_no, job_order_id, amount_cents, to_receivable_cents, to_deposit_cents FROM col_applications WHERE document_id = ? ORDER BY line_no')
        .all(documentId) as { line_no: number; job_order_id: string; amount_cents: number; to_receivable_cents: number; to_deposit_cents: number }[]
    ).map((a) => ({
      jobOrderId: a.job_order_id,
      amountCents: a.amount_cents,
      lineNo: a.line_no,
      jobOrderNumber: jobOrderRef(db, a.job_order_id)?.number ?? '?',
      toReceivableCents: a.to_receivable_cents,
      toDepositCents: a.to_deposit_cents,
    }));
    return {
      customerId: r.customer_id,
      crNumber: r.cr_number,
      ...(r.cwt_atc && r.cert_2307 ? { withholding: { cwtCents: r.cwt_cents, atc: r.cwt_atc, certificate: r.cert_2307 } } : {}),
      ...(r.settle_small_difference ? { settleSmallDifference: true } : {}),
      ...(r.note ? { note: r.note } : {}),
      applications,
      tenders: loadTenders(db, 'col_tenders', documentId),
      customerName: r.customer_name,
      cwtCents: r.cwt_cents,
      appliedCents: sumCents(applications),
      unappliedCents: r.unapplied_cents,
      shortOverCents: r.short_over_cents,
      totalCents: r.total_cents,
    };
  },

  toInput(doc) {
    const { customerId, crNumber, withholding, settleSmallDifference, note } = doc;
    return {
      customerId,
      crNumber,
      applications: doc.applications.map(({ jobOrderId, amountCents }) => ({ jobOrderId, amountCents })),
      tenders: doc.tenders.map(tenderToInput),
      ...(withholding ? { withholding } : {}),
      ...(settleSmallDifference ? { settleSmallDifference } : {}),
      ...(note ? { note } : {}),
    };
  },

  /**
   * Refunds that paid out this collection's deposit: cancelling the collection first would leave the deposits
   * account owing the customer less than nothing (D6). Deposits used by an invoice record will reopen the balance
   * due instead, when the invoice record lands.
   */
  dependents(db, documentId) {
    const d = collectionDoc.load(db, documentId);
    const parts: [string | null, number][] = [
      ...d.applications.filter((a) => a.toDepositCents > 0).map((a): [string, number] => [a.jobOrderId, a.toDepositCents]),
      ...(d.unappliedCents > 0 ? [[null, d.unappliedCents] as [null, number]] : []),
    ];
    const refunds = db.prepare(
      `SELECT d.id, d.number FROM col_refunds r JOIN documents d ON d.id = r.document_id WHERE r.customer_id = ? AND r.job_order_id IS ? AND d.status = 'posted' ORDER BY d.number`,
    );
    return parts
      .filter(([jo, cents]) => depositsHeld(db, d.customerId, jo) < cents)
      .flatMap(([jo]) => refunds.all(d.customerId, jo) as { id: string; number: string }[]);
  },

  summary(doc) {
    const cash = sumCents(doc.tenders);
    const where = doc.tenders.length === 1 ? ` in ${doc.tenders[0]!.cashPlaceName}` : ` (${doc.tenders.map((t) => `${formatPeso(t.amountCents)} in ${t.cashPlaceName}`).join(', ')})`;
    const cwt = doc.cwtCents > 0 ? ` plus ${formatPeso(doc.cwtCents)} tax withheld (2307)` : '';
    const uses = [
      ...doc.applications.map((a) => `${formatPeso(a.amountCents)} for ${a.jobOrderNumber}`),
      ...(doc.unappliedCents > 0 ? [`${formatPeso(doc.unappliedCents)} kept as deposit`] : []),
    ];
    const diff = doc.shortOverCents === 0 ? '' : ` ${formatPeso(Math.abs(doc.shortOverCents))} ${doc.shortOverCents > 0 ? 'over' : 'short'} goes to cash short and over.`;
    return `This will record ${formatPeso(cash)} received from ${doc.customerName}${where}${cwt}, CR ${doc.crNumber}${uses.length ? `: ${uses.join(', ')}` : ''}.${diff}`;
  },

  arbitrary(db) {
    const places = listCashPlaces(db).map((c) => c.id);
    const byCustomer = new Map<string, { id: string; dueCents: number }[]>();
    for (const jo of jobOrdersOf(db)) {
      const dueCents = joMoney(db, jo.id).balanceDueCents;
      if (dueCents > 0 && customerRef(db, jo.customerId)?.is_active === 1) byCustomer.set(jo.customerId, [...(byCustomer.get(jo.customerId) ?? []), { id: jo.id, dueCents }]);
    }
    if (byCustomer.size === 0) throw new Error('col.collection.arbitrary needs an active customer with a job order that has a balance due');
    return fc.constantFrom(...byCustomer.keys()).chain((customerId) => {
      const app = fc.constantFrom(...byCustomer.get(customerId)!).chain((jo) => fc.integer({ min: 1, max: Math.min(jo.dueCents, 2_000_000) }).map((amountCents) => ({ jobOrderId: jo.id, amountCents })));
      return fc
        .record({
          applications: fc.uniqueArray(app, { maxLength: 2, selector: (a) => a.jobOrderId }),
          weights: fc.array(fc.tuple(fc.constantFrom(...places), fc.integer({ min: 1, max: 5 })), { minLength: 1, maxLength: 3 }),
          extraCents: fc.integer({ min: 0, max: 300_000 }), // received beyond the applied amount: kept as deposit
          cwtBp: fc.constantFrom(0, 100, 200),
          cr: fc.integer({ min: 1, max: 99_999_999 }),
        })
        .map(({ applications, weights, extraCents, cwtBp, cr }) => {
          const applied = sumCents(applications);
          const total = Math.max(applied + extraCents, 1_000); // every tender gets at least a centavo
          const cwtCents = cwtBp ? applyRate(vatFromGross(total, VAT_BP).netCents, cwtBp) : 0;
          const amounts = allocate(total - cwtCents, weights.map(([, w]) => w));
          return {
            customerId,
            crNumber: String(cr).padStart(6, '0'),
            applications,
            tenders: weights.map(([cashPlaceId], i) => ({ cashPlaceId, amountCents: amounts[i]! })),
            ...(cwtCents > 0 ? { withholding: { cwtCents, atc: cwtBp === 100 ? ('WC158' as const) : ('WC160' as const), certificate: 'pending' as const } } : {}),
          };
        });
    });
  },
};
