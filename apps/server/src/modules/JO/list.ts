/**
 * The job order list (read-only): the rows of the general document list (newest first, the same paging, status and date
 * filters), with each order's balance due (PLAN H3, worked out from the ledger, NR-2), and a search that also reads
 * what was ordered. The search takes each typed word on its own, in any order, singular or plural, and ignores hyphens and
 * spaces inside a word, so "rowing jerseys" finds "Jersey for the rowing team" and "tshirt" finds "T-shirt".
 */
import type { FastifyInstance } from 'fastify';
import { AppError, isBusinessDate } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { joMoney } from './public.ts';

export type JoListFilters = { q?: string; from?: string; to?: string };

/** A typed word as the patterns it is looked for with: as typed, and without its plural ending. */
export function searchWords(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/[\s,;/]+/).map((w) => w.trim()).filter(Boolean))].slice(0, 8)
    .map((w) => (w.length > 4 && w.endsWith('es') && /(s|x|z|ch|sh)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}
const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
/** Hyphens and spaces taken out, so "t-shirt", "t shirt" and "tshirt" read the same. */
const squeeze = (sql: string) => `REPLACE(REPLACE(LOWER(${sql}), '-', ''), ' ', '')`;

function filtersOf(query: JoListFilters): { where: string; params: Record<string, string | null> } {
  const q = (query.q ?? '').trim();
  if (q.length > 100) throw new AppError('BAD_SEARCH', 'Type at most 100 characters to search.', 400);
  for (const [which, d] of [['first', query.from], ['last', query.to]] as const) {
    if (d !== undefined && d !== '' && !isBusinessDate(d)) throw new AppError('BAD_DATE', `Type the ${which} date like 2026-09-30.`, 400);
  }
  const params: Record<string, string | null> = { from: query.from || null, to: query.to || null };
  const each = searchWords(q).map((w, i) => {
    params[`w${i}`] = like(w);
    params[`s${i}`] = like(w.replace(/-/g, ''));
    return `(LOWER(d.number) LIKE @w${i} ESCAPE '\\' OR LOWER(d.summary) LIKE @w${i} ESCAPE '\\' OR LOWER(o.customer_name) LIKE @w${i} ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM jo_lines l WHERE l.document_id = d.id AND (LOWER(l.description) LIKE @w${i} ESCAPE '\\' OR ${squeeze('l.description')} LIKE @s${i} ESCAPE '\\')))`;
  });
  const where = [...each, '(@from IS NULL OR d.business_date >= @from)', '(@to IS NULL OR d.business_date <= @to)'].join(' AND ');
  return { where, params };
}

/** The first item of an order the search words are found in, to show why it matched; null when no item has them all. */
function matchedItem(db: Db, id: string, words: string[]): string | null {
  const lines = db.prepare('SELECT description FROM jo_lines WHERE document_id = ? ORDER BY line_no').pluck().all(id) as string[];
  const flat = (s: string) => s.toLowerCase().replace(/[-\s]/g, '');
  return lines.find((l) => words.every((w) => l.toLowerCase().includes(w) || flat(l).includes(w.replace(/-/g, '')))) ?? null;
}

export function joListRoutes(app: FastifyInstance, db: Db): void {
  const FROM = 'FROM documents d JOIN jo_orders o ON o.document_id = d.id WHERE d.doc_type = \'jo.job_order\'';

  /** As GET /api/docs/jo.job_order, with `balanceDueCents` (0 once cancelled) and `matchedItem` when a search found it in an item. */
  app.get<{ Querystring: JoListFilters & { limit?: string; before?: string; status?: string } }>('/api/jo/list', { config: { permission: 'jo.view' } }, async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 25) || 25, 1), 200);
    const { where, params } = filtersOf(req.query);
    const rows = db.prepare(`SELECT d.id, d.number, d.business_date, d.status, d.total_cents, d.summary, d.posted_at, d.cancelled_at, d.cancel_reason,
        d.replaces_id, d.replaced_by_id, d.external_number ${FROM} AND (@before IS NULL OR d.posted_at < @before) AND (@status IS NULL OR d.status = @status)
        AND ${where} ORDER BY d.posted_at DESC, d.number DESC LIMIT @limit`)
      .all({ ...params, before: req.query.before ?? null, status: req.query.status ?? null, limit }) as Record<string, unknown>[];
    const words = searchWords(req.query.q ?? '');
    return rows.map((r) => ({
      id: r.id, number: r.number, businessDate: r.business_date, status: r.status, totalCents: r.total_cents, summary: r.summary,
      postedAt: r.posted_at, cancelledAt: r.cancelled_at ?? null, cancelReason: r.cancel_reason ?? null, replacesId: r.replaces_id ?? null,
      replacedById: r.replaced_by_id ?? null, externalNumber: r.external_number ?? null,
      balanceDueCents: r.status === 'posted' ? joMoney(db, r.id as string).balanceDueCents : 0,
      matchedItem: words.length ? matchedItem(db, r.id as string, words) : null,
    }));
  });

  /** How many job orders the same filters find, recorded and cancelled (the list's tabs). */
  app.get<{ Querystring: JoListFilters }>('/api/jo/list/counts', { config: { permission: 'jo.view' } }, async (req) => {
    const { where, params } = filtersOf(req.query);
    const rows = db.prepare(`SELECT d.status, COUNT(*) AS n ${FROM} AND ${where} GROUP BY d.status`).all(params) as { status: string; n: number }[];
    const n = (status: string) => rows.find((r) => r.status === status)?.n ?? 0;
    return { all: n('posted') + n('cancelled'), posted: n('posted'), cancelled: n('cancelled') };
  });
}
