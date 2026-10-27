/**
 * The purchasing lists (read-only, the owner's request, 26 Oct 2026): the rows of the general document list for purchase
 * requests, purchase orders and receiving reports (newest first, the same paging, status and date filters), each with
 * what its row shows in place of the long summary sentence, and the figures above each list.
 *   request: where it stands (waiting, approved, not approved, ordered or paid), what for, who asked, by when;
 *   order:   the supplier, the expected date (late once past with goods still to come), how much is received and billed;
 *   report:  the supplier, the order, what came and what it is worth at the order's costs, and its bill.
 * The search reads the number, the summary, the supplier's name and what is bought, each typed word on its own.
 */
import type { FastifyInstance } from 'fastify';
import { AppError, isBusinessDate } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import type { Db } from '../../platform/db/driver.ts';
import { today } from '../../platform/clock.ts';
import { poLines } from './lookups.ts';
import { fromHundredths, lineCents, lineCentsSql, toHundredths } from './qty.ts';
import { requestStatus, type RequestState } from './requests.ts';

type Filters = { q?: string; from?: string; to?: string };
type Kind = 'request' | 'po' | 'rr';

const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Where each list reads its rows, the text its search reads, and who may see it. */
const KINDS: Record<Kind, { docType: string; permission: string; from: string; text: string[] }> = {
  request: {
    docType: 'pur.request', permission: 'pur.request.view',
    from: 'FROM documents d JOIN pur_requests r ON r.document_id = d.id LEFT JOIN pur_suppliers s ON s.id = r.supplier_id',
    text: ['r.purpose', 's.name', '(SELECT GROUP_CONCAT(l.description, \' \') FROM pur_request_lines l WHERE l.document_id = d.id)'],
  },
  po: {
    docType: 'pur.po', permission: 'pur.po.view',
    from: 'FROM documents d JOIN pur_purchase_orders po ON po.document_id = d.id JOIN pur_suppliers s ON s.id = po.supplier_id',
    text: ['s.name', '(SELECT GROUP_CONCAT(x.name, \' \') FROM pur_po_lines l JOIN pur_supplies x ON x.id = l.supply_id WHERE l.document_id = d.id)'],
  },
  rr: {
    docType: 'pur.rr', permission: 'pur.rr.view',
    from: `FROM documents d JOIN pur_receiving_reports r ON r.document_id = d.id JOIN documents pd ON pd.id = r.po_document_id
      JOIN pur_purchase_orders po ON po.document_id = r.po_document_id JOIN pur_suppliers s ON s.id = po.supplier_id`,
    text: ['s.name', 'pd.number', `(SELECT GROUP_CONCAT(x.name, ' ') FROM pur_rr_lines l JOIN pur_po_lines p ON p.document_id = l.po_document_id AND p.line_no = l.po_line_no
      JOIN pur_supplies x ON x.id = p.supply_id WHERE l.document_id = d.id)`],
  },
};

function filtersOf(kind: Kind, query: Filters): { where: string; params: Record<string, string | null> } {
  const q = (query.q ?? '').trim();
  if (q.length > 100) throw new AppError('BAD_SEARCH', 'Type at most 100 characters to search.', 400);
  for (const [which, d] of [['first', query.from], ['last', query.to]] as const) {
    if (d !== undefined && d !== '' && !isBusinessDate(d)) throw new AppError('BAD_DATE', `Type the ${which} date like 2026-09-30.`, 400);
  }
  const params: Record<string, string | null> = { docType: KINDS[kind].docType, from: query.from || null, to: query.to || null };
  const columns = ['d.number', 'd.summary', ...KINDS[kind].text];
  const words = [...new Set(q.toLowerCase().split(/[\s,;/]+/).filter(Boolean))].slice(0, 8);
  const each = words.map((w, i) => {
    params[`w${i}`] = like(w);
    return `(${columns.map((c) => `LOWER(COALESCE(${c}, '')) LIKE @w${i} ESCAPE '\\'`).join(' OR ')})`;
  });
  return { where: ['d.doc_type = @docType', ...each, '(@from IS NULL OR d.business_date >= @from)', '(@to IS NULL OR d.business_date <= @to)'].join(' AND '), params };
}

/** The recorded supplier bill that names a receiving report (AP's ap_bills, read-only, as the lookups read it). */
const billOf = (db: Db, rrId: string) => (db.prepare(`SELECT d.id, d.number FROM ap_bills b JOIN documents d ON d.id = b.document_id
  WHERE b.receiving_report_id = ? AND d.status = 'posted' ORDER BY d.number LIMIT 1`).get(rrId) as { id: string; number: string } | undefined) ?? null;

/** A purchase order's progress: pieces ordered and received (no more than ordered, per line), deliveries and those billed, and what is still to come at its costs. */
export function poProgress(db: Db, poId: string) {
  const lines = poLines(db, poId);
  const deliveries = db.prepare(`SELECT d.id FROM pur_receiving_reports r JOIN documents d ON d.id = r.document_id WHERE r.po_document_id = ? AND d.status = 'posted'`).pluck().all(poId) as string[];
  return {
    // Added up in hundredths of a unit (quantities may have decimals, Oct 27, 2026), shown as plain quantities.
    orderedQty: fromHundredths(lines.reduce((n, l) => n + toHundredths(l.orderedQty), 0)),
    receivedQty: fromHundredths(lines.reduce((n, l) => n + toHundredths(Math.min(l.receivedQty, l.orderedQty)), 0)),
    toReceiveCents: lines.reduce((n, l) => n + lineCents(toHundredths(l.remainingQty), l.unitCostCents), 0),
    deliveries: deliveries.length,
    billed: deliveries.filter((id) => billOf(db, id)).length,
  };
}

/** What a receiving report brought: its lines' pieces and their worth at the order's costs. */
function rrGoods(db: Db, rrId: string) {
  return db.prepare(`SELECT COUNT(*) AS lines, COALESCE(SUM(l.qty_hundredths), 0) / 100.0 AS qty, COALESCE(SUM(${lineCentsSql('l.qty_hundredths', 'p.unit_cost_cents')}), 0) AS valueCents
    FROM pur_rr_lines l JOIN pur_po_lines p ON p.document_id = l.po_document_id AND p.line_no = l.po_line_no WHERE l.document_id = ?`).get(rrId) as { lines: number; qty: number; valueCents: number };
}

function extras(db: Db, kind: Kind, id: string, posted: boolean, date: string): Record<string, unknown> {
  if (kind === 'request') {
    const r = requestStatus(db, id)!;
    return { state: r.state, purpose: r.purpose, requestedByName: r.requestedByName, neededBy: r.neededBy, supplierName: r.supplierName, lineCount: r.lines.length,
      usedBy: r.usedBy, late: r.state === 'waiting' && !!r.neededBy && r.neededBy < date };
  }
  if (kind === 'po') {
    const h = db.prepare(`SELECT s.name AS supplierName, po.expected_date AS expectedDate, rd.number AS requestNumber, po.request_id AS requestId
      FROM pur_purchase_orders po JOIN pur_suppliers s ON s.id = po.supplier_id LEFT JOIN documents rd ON rd.id = po.request_id WHERE po.document_id = ?`).get(id) as Record<string, string | null>;
    const p = poProgress(db, id);
    return { ...h, ...p, late: posted && !!h.expectedDate && h.expectedDate < date && p.receivedQty < p.orderedQty };
  }
  const h = db.prepare(`SELECT s.name AS supplierName, pd.id AS poId, pd.number AS poNumber FROM pur_receiving_reports r JOIN documents pd ON pd.id = r.po_document_id
    JOIN pur_purchase_orders po ON po.document_id = r.po_document_id JOIN pur_suppliers s ON s.id = po.supplier_id WHERE r.document_id = ?`).get(id) as Record<string, string>;
  return { ...h, ...rrGoods(db, id), bill: posted ? billOf(db, id) : null };
}

/** The figures above each list: what waits at each step, counted over recorded documents. */
function summaryOf(db: Db, kind: Kind, date: string) {
  const ids = db.prepare('SELECT id FROM documents WHERE doc_type = ? AND status = \'posted\'').pluck().all(KINDS[kind].docType) as string[];
  const month = date.slice(0, 7);
  if (kind === 'request') {
    const all = ids.map((id) => requestStatus(db, id)!);
    const sum = (state: RequestState) => { const s = all.filter((r) => r.state === state); return { count: s.length, cents: s.reduce((n, r) => n + r.totalCents, 0) }; };
    return { waiting: sum('waiting'), approved: sum('approved'), rejected: sum('rejected'), used: sum('used') };
  }
  if (kind === 'po') {
    let open = 0, toReceiveCents = 0, late = 0, toBill = 0, monthCents = 0;
    for (const id of ids) {
      const p = poProgress(db, id);
      const h = db.prepare(`SELECT d.business_date AS date, d.total_cents AS totalCents, po.expected_date AS expectedDate FROM documents d
        JOIN pur_purchase_orders po ON po.document_id = d.id WHERE d.id = ?`).get(id) as { date: string; totalCents: number; expectedDate: string | null };
      if (h.date.startsWith(month)) monthCents += h.totalCents;
      toBill += p.deliveries - p.billed;
      if (p.receivedQty >= p.orderedQty) continue;
      open++; toReceiveCents += p.toReceiveCents;
      if (h.expectedDate && h.expectedDate < date) late++;
    }
    return { open, toReceiveCents, late, toBill, monthCents };
  }
  let monthCount = 0, toBill = 0, toBillCents = 0, monthCents = 0;
  for (const id of ids) {
    const d = db.prepare('SELECT business_date FROM documents WHERE id = ?').pluck().get(id) as string;
    const g = rrGoods(db, id);
    if (d.startsWith(month)) { monthCount++; monthCents += g.valueCents; }
    if (!billOf(db, id)) { toBill++; toBillCents += g.valueCents; }
  }
  const waiting = (db.prepare(`SELECT d.id FROM documents d WHERE d.doc_type = 'pur.po' AND d.status = 'posted'`).pluck().all() as string[])
    .filter((id) => { const p = poProgress(db, id); return p.receivedQty < p.orderedQty; }).length;
  return { month: monthCount, monthCents, toBill, toBillCents, ordersWaiting: waiting };
}

export function purListRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const { from, permission } = KINDS[kind];
    /** As GET /api/docs/<type>, each row with its own words (see the file's comment). */
    app.get<{ Querystring: Filters & { limit?: string; before?: string; status?: string } }>(`/api/pur/list/${kind}`, { config: { permission } }, async (req) => {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 25) || 25, 1), 200);
      const { where, params } = filtersOf(kind, req.query);
      const rows = db.prepare(`SELECT d.id, d.number, d.business_date, d.status, d.total_cents, d.summary, d.posted_at, d.cancelled_at, d.cancel_reason,
          d.replaces_id, d.replaced_by_id, d.external_number ${from} WHERE ${where} AND (@before IS NULL OR d.posted_at < @before) AND (@status IS NULL OR d.status = @status)
          ORDER BY d.posted_at DESC, d.number DESC LIMIT @limit`)
        .all({ ...params, before: req.query.before ?? null, status: req.query.status ?? null, limit }) as Record<string, unknown>[];
      const date = today(clock);
      return rows.map((r) => ({
        id: r.id, number: r.number, businessDate: r.business_date, status: r.status, totalCents: r.total_cents, summary: r.summary,
        postedAt: r.posted_at, cancelledAt: r.cancelled_at ?? null, cancelReason: r.cancel_reason ?? null, replacesId: r.replaces_id ?? null,
        replacedById: r.replaced_by_id ?? null, externalNumber: r.external_number ?? null,
        ...extras(db, kind, r.id as string, r.status === 'posted', date),
      }));
    });

    /** How many the same filters find, recorded and cancelled (the list's tabs). */
    app.get<{ Querystring: Filters }>(`/api/pur/list/${kind}/counts`, { config: { permission } }, async (req) => {
      const { where, params } = filtersOf(kind, req.query);
      const rows = db.prepare(`SELECT d.status, COUNT(*) AS n ${from} WHERE ${where} GROUP BY d.status`).all(params) as { status: string; n: number }[];
      const n = (status: string) => rows.find((r) => r.status === status)?.n ?? 0;
      return { all: n('posted') + n('cancelled'), posted: n('posted'), cancelled: n('cancelled') };
    });

    app.get(`/api/pur/list/${kind}/summary`, { config: { permission } }, async () => summaryOf(db, kind, today(clock)));
  }
}
