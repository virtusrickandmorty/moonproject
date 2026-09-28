/**
 * Job Order (PLAN E4, D3). A commitment, not a sale: it records what the customer ordered, for whom and at
 * what price, and posts NO journal (D5 JO-POST). Balance due is derived on read (public.ts), never stored.
 * Commercial changes after recording = cancel and reissue (NR-4); the stage carries over to the replacement.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { applyRate, conflict, formatPeso, manilaDate, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { activeChart, activeWearers, customer, wearer, type Wearer } from '../cus.ts';
import { carryStageOver } from '../stages.ts';

export const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
export const PAYMENT_TERMS = ['dp50', 'full', 'cod', 'net7', 'net15', 'net30'] as const;
/** Downpayment asked before work starts, in basis points of the total (E4 "required downpayment"). */
const DOWNPAYMENT_BP: Record<(typeof PAYMENT_TERMS)[number], number> = { dp50: 5000, full: 10000, cod: 0, net7: 0, net15: 0, net30: 0 };

const text = (max: number) => z.string().trim().min(1).max(max);

const rosterRow = z
  .object({
    personId: z.uuid().optional(), // a wearer of this customer, or
    name: text(120).optional(), // a one-off name
    sizeMode: z.enum(['preset', 'measured']),
    size: text(20).optional(),
    jerseyName: text(40).optional(),
    jerseyNumber: text(10).optional(),
    qty: z.number().int().min(1).max(1000),
    notes: text(200).optional(),
  })
  .strict();

export const lineInput = z
  .object({
    kind: z.enum(['made_to_order', 'service', 'ready_made']),
    description: text(200),
    qty: z.number().int().min(1).max(10_000), // with the price cap, 50 lines stay a safe integer
    unitPriceCents: z.number().int().min(0).max(MAX_CENTS), // VAT-inclusive
    discountCents: z.number().int().min(0).max(MAX_CENTS),
    roster: z.array(rosterRow).max(1000),
  })
  .strict();

export const jobOrderInput = z
  .object({
    customerId: z.uuid(),
    contact: text(200).optional(),
    dueInDays: z.number().int().min(1).max(365).default(15), // the server turns this into the due date (NR-6)
    priority: z.enum(['normal', 'rush']),
    paymentTerms: z.enum(PAYMENT_TERMS),
    notes: text(1000).optional(),
    lines: z.array(lineInput).min(1).max(50),
  })
  .strict();
export type JobOrderInput = z.infer<typeof jobOrderInput>;
type RosterInput = z.infer<typeof rosterRow>;

export interface RosterRow extends RosterInput { rowNo: number; wearerName: string; groupId: string | null; chartId: string | null; chartRevision: number | null }
export interface JoLine extends Omit<z.infer<typeof lineInput>, 'roster'> { lineNo: number; lineTotalCents: number; roster: RosterRow[] }
export interface JobOrder extends Omit<JobOrderInput, 'lines'> {
  lines: JoLine[];
  customerName: string;
  dueDate: string;
  requiredDownpaymentCents: number;
  totalCents: number;
}

export const addDays = (date: string, days: number) => manilaDate(new Date(Date.parse(`${date}T00:00:00+08:00`) + days * 86_400_000));
/** SQL NULL -> field left out, as zod leaves out a missing optional field. */
export const dropNulls = (o: object, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== null || !keys.includes(k)));

/*
 * The lines of a job order, shared with the opening job order (opening.ts): both keep them in jo_lines and jo_roster,
 * so production, releases and invoice records read them the same way.
 */

export function computeLines(db: Db, lines: readonly z.infer<typeof lineInput>[]): JoLine[] {
  return lines.map((l, i) => ({
    ...l,
    lineNo: i + 1,
    lineTotalCents: l.qty * l.unitPriceCents - l.discountCents,
    roster: l.roster.map((r, j) => {
      const w = r.personId ? wearer(db, r.personId) : undefined;
      const chart = w && r.sizeMode === 'measured' ? activeChart(db, w.id) : undefined;
      return {
        ...r,
        ...(r.jerseyName ? { jerseyName: r.jerseyName.toUpperCase() } : {}),
        rowNo: j + 1,
        wearerName: w?.name ?? r.name ?? '',
        groupId: w?.groupId ?? null,
        chartId: chart?.id ?? null,
        chartRevision: chart?.revision ?? null,
      };
    }),
  }));
}

export const linesTotal = (lines: readonly JoLine[]) => lines.reduce((s, l) => s + l.lineTotalCents, 0);

/** Each line's discount and roster (wearers of this customer, sizes, measurements). */
export function lineIssues(db: Db, doc: { customerId: string; customerName: string; lines: readonly JoLine[] }): Issue[] {
  const issues: Issue[] = [];
  const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
  for (const l of doc.lines) {
    const at = `lines.${l.lineNo - 1}`;
    if (l.lineTotalCents < 0) error(`${at}.discountCents`, 'DISCOUNT', `Line ${l.lineNo}: the discount is more than the line amount.`);
    const pieces = l.roster.reduce((s, r) => s + r.qty, 0);
    if (l.roster.length > 0 && pieces !== l.qty) error(`${at}.roster`, 'ROSTER_QTY', `Line ${l.lineNo} is for ${l.qty} pieces but the roster lists ${pieces}.`);
    const seen = new Set<string>();
    for (const r of l.roster) {
      const [f, where] = [`${at}.roster.${r.rowNo - 1}`, `Line ${l.lineNo}, row ${r.rowNo}`];
      if (!r.personId === !r.name) {
        error(`${f}.personId`, 'WEARER', `${where}: pick a wearer from the list or type a one-off name.`);
        continue;
      }
      const w = r.personId ? wearer(db, r.personId) : undefined;
      if (r.personId && (!w?.active || w.customerId !== doc.customerId)) error(`${f}.personId`, 'WEARER', `${where}: pick one of ${doc.customerName}'s active wearers.`);
      if (w && seen.has(w.id)) issues.push({ field: `${f}.personId`, code: 'WEARER_TWICE', level: 'warning', message: `${where}: ${w.name} is already on this line.` });
      if (w) seen.add(w.id);
      if (r.sizeMode === 'preset' && !r.size) error(`${f}.size`, 'SIZE', `${where}: pick a size.`);
      if (r.sizeMode === 'measured' && !r.chartId) error(`${f}.sizeMode`, 'NOT_MEASURED', `${where}: ${r.wearerName || 'this wearer'} has no measurements on file. Measure first or pick a size.`);
    }
  }
  return issues;
}

export function persistLines(db: Db, documentId: string, lines: readonly JoLine[]): void {
  const line = db.prepare(
    'INSERT INTO jo_lines (document_id, line_no, kind, description, qty, unit_price_cents, discount_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const row = db.prepare(
    `INSERT INTO jo_roster (document_id, line_no, row_no, person_id, group_id, wearer_name, size_mode, size, chart_id, chart_revision, jersey_name, jersey_number, qty, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const l of lines) {
    line.run(documentId, l.lineNo, l.kind, l.description, l.qty, l.unitPriceCents, l.discountCents, l.lineTotalCents);
    for (const r of l.roster) {
      row.run(documentId, l.lineNo, r.rowNo, r.personId ?? null, r.groupId, r.wearerName, r.sizeMode, r.size ?? null, r.chartId, r.chartRevision, r.jerseyName ?? null, r.jerseyNumber ?? null, r.qty, r.notes ?? null);
    }
  }
}

export function loadLines(db: Db, documentId: string): JoLine[] {
  const rows = db
    .prepare(
      `SELECT line_no AS lineNo, person_id AS personId, CASE WHEN person_id IS NULL THEN wearer_name END AS name, size_mode AS sizeMode, size,
         jersey_name AS jerseyName, jersey_number AS jerseyNumber, qty, notes, row_no AS rowNo, wearer_name AS wearerName, group_id AS groupId,
         chart_id AS chartId, chart_revision AS chartRevision
       FROM jo_roster WHERE document_id = ? ORDER BY line_no, row_no`,
    )
    .all(documentId) as { lineNo: number }[];
  const lines = db
    .prepare(
      `SELECT kind, description, qty, unit_price_cents AS unitPriceCents, discount_cents AS discountCents, line_no AS lineNo, line_total_cents AS lineTotalCents
       FROM jo_lines WHERE document_id = ? ORDER BY line_no`,
    )
    .all(documentId) as Omit<JoLine, 'roster'>[];
  const roster = (lineNo: number) =>
    rows.filter((r) => r.lineNo === lineNo).map(({ lineNo: _, ...r }) => dropNulls(r, ['personId', 'name', 'size', 'jerseyName', 'jerseyNumber', 'notes']) as unknown as RosterRow);
  return lines.map((l) => ({ ...l, roster: roster(l.lineNo) }));
}

export const linesToInput = (lines: readonly JoLine[]) =>
  lines.map(({ kind, description, qty, unitPriceCents, discountCents, roster }) => ({
    kind,
    description,
    qty,
    unitPriceCents,
    discountCents,
    roster: roster.map(({ rowNo: _r, wearerName: _w, groupId: _g, chartId: _c, chartRevision: _v, ...r }) => r),
  }));

export const jobOrderDoc: DocTypeDef<JobOrderInput, JobOrder> = {
  key: 'jo.job_order',
  module: 'JO',
  title: 'Job Order',
  numbering: { series: { key: 'JO', prefix: 'JO-' } },
  permissions: { view: 'jo.view', create: 'jo.create', post: 'jo.post', cancel: 'jo.cancel' },
  dating: 'system',
  inputSchema: jobOrderInput,

  compute(input, ctx) {
    const lines = computeLines(ctx.db, input.lines);
    const totalCents = linesTotal(lines);
    return {
      ...input,
      lines,
      customerName: customer(ctx.db, input.customerId)?.name ?? '?',
      dueDate: addDays(ctx.businessDate, input.dueInDays),
      requiredDownpaymentCents: totalCents <= MAX_CENTS ? applyRate(totalCents, DOWNPAYMENT_BP[input.paymentTerms]) : 0, // over the guard: refused in validate
      totalCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const c = customer(ctx.db, doc.customerId);
    if (!c?.active) error('customerId', 'CUSTOMER', c ? `${c.name} is inactive. Pick an active customer.` : 'Pick a customer.');
    if (doc.totalCents > MAX_CENTS) error('lines', 'TOO_BIG', 'The total is over ₱100 million. Please check the quantities and prices.');
    issues.push(...lineIssues(ctx.db, doc));
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO jo_orders (document_id, customer_id, customer_name, contact, due_date, priority, payment_terms, required_dp_cents, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.customerId, doc.customerName, doc.contact ?? null, doc.dueDate, doc.priority, doc.paymentTerms, doc.requiredDownpaymentCents, doc.notes ?? null);
    persistLines(db, h.documentId, doc.lines);
  },

  load(db, documentId) {
    const o = db
      .prepare(
        `SELECT o.customer_id AS customerId, o.contact, CAST(julianday(o.due_date) - julianday(d.business_date) AS INTEGER) AS dueInDays, o.priority,
           o.payment_terms AS paymentTerms, o.notes, o.customer_name AS customerName, o.due_date AS dueDate,
           o.required_dp_cents AS requiredDownpaymentCents, d.total_cents AS totalCents
         FROM jo_orders o JOIN documents d ON d.id = o.document_id WHERE o.document_id = ?`,
      )
      .get(documentId) as object | undefined;
    if (!o) throw new Error(`Job order ${documentId} not found`);
    return { ...(dropNulls(o, ['contact', 'notes']) as Omit<JobOrder, 'lines'>), lines: loadLines(db, documentId) };
  },

  toInput(doc) {
    const { customerId, contact, dueInDays, priority, paymentTerms, notes } = doc;
    return {
      customerId,
      ...(contact ? { contact } : {}),
      dueInDays,
      priority,
      paymentTerms,
      ...(notes ? { notes } : {}),
      lines: linesToInput(doc.lines),
    };
  },

  /** Its releases and invoice records: cancel those first (D6), invoice records before their releases. */
  dependents(db, documentId) {
    return db
      .prepare(
        `SELECT d.id, d.number FROM documents d
         WHERE d.status = 'posted' AND d.id IN (SELECT document_id FROM jo_invoice_records WHERE job_order_id = @jo UNION SELECT document_id FROM jo_releases WHERE job_order_id = @jo)
         ORDER BY d.doc_type = 'jo.release', d.number`,
      )
      .all({ jo: documentId }) as { id: string; number: string }[];
  },

  relinkOnReissue(db, oldId, newId) {
    // The engine skips dependents on reissue when this hook exists, but a released JO still cannot be edited (D6).
    const deps = jobOrderDoc.dependents!(db, oldId);
    if (deps.length > 0) throw conflict('HAS_DEPENDENTS', `Cancel these first: ${deps.map((x) => x.number).join(', ')}.`, deps);
    carryStageOver(db, oldId, newId);
  },

  summary(doc) {
    const pieces = doc.lines.reduce((s, l) => s + l.qty, 0);
    const dp = doc.requiredDownpaymentCents > 0 ? ` Downpayment asked: ${formatPeso(doc.requiredDownpaymentCents)}.` : '';
    return `This will record a job order for ${doc.customerName}: ${pieces} ${pieces === 1 ? 'piece' : 'pieces'}, ${formatPeso(doc.totalCents)}, due ${doc.dueDate}.${dp} Nothing goes into the books until the invoice is recorded at release.`;
  },

  arbitrary(db) {
    const byCustomer = new Map<string, Wearer[]>();
    for (const w of activeWearers(db)) byCustomer.set(w.customerId, [...(byCustomer.get(w.customerId) ?? []), w]);
    if (byCustomer.size === 0) throw new Error('jo.job_order.arbitrary needs at least one customer with active wearers');
    return fc.constantFrom(...byCustomer.keys()).chain((customerId) => {
      const who = fc.oneof(fc.constantFrom(...byCustomer.get(customerId)!).map((w) => ({ personId: w.id })), fc.constant({ name: 'One-off Wearer' }));
      const row = fc.record({ who, size: fc.constantFrom('S', 'M', 'L', '2XL'), jerseyName: fc.constantFrom(undefined, 'ace', 'Dela Cruz'), qty: fc.integer({ min: 1, max: 3 }) });
      const line = fc
        .record({ roster: fc.array(row, { maxLength: 4 }), qty: fc.integer({ min: 1, max: 30 }), unitPriceCents: fc.integer({ min: 0, max: 500_000 }), discountPct: fc.integer({ min: 0, max: 100 }) })
        .map(({ roster, qty, unitPriceCents, discountPct }) => {
          const pieces = roster.length > 0 ? roster.reduce((s, r) => s + r.qty, 0) : qty;
          return {
            kind: 'made_to_order' as const,
            description: 'Team jersey set',
            qty: pieces,
            unitPriceCents,
            discountCents: Math.floor((pieces * unitPriceCents * discountPct) / 100),
            roster: roster.map(({ who, size, jerseyName, qty: n }) => ({ ...who, sizeMode: 'preset' as const, size, ...(jerseyName ? { jerseyName } : {}), qty: n })),
          };
        });
      return fc
        .record({ lines: fc.array(line, { minLength: 1, maxLength: 3 }), dueInDays: fc.integer({ min: 1, max: 60 }), priority: fc.constantFrom('normal' as const, 'rush' as const), paymentTerms: fc.constantFrom(...PAYMENT_TERMS) })
        .map((r) => ({ customerId, ...r }));
    });
  },
};
