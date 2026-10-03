/** Loose-leaf print of the six BIR books (ACC-04): page counter, reprint warning, paper setting. Posts nothing. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { stamp, today } from '../../platform/clock.ts';
import { tx, type Db } from '../../platform/db/driver.ts';
import { BIR_BOOKS, BOOK_TITLES, buildBook, sampleBook, type BirBook } from './books-print.ts';
import { PAPERS, layoutBook, renderLooseLeaf, type Paper } from './loose-leaf.ts';
import type { Profile } from './print.ts';

const printInput = z.object({ from: z.iso.date(), to: z.iso.date(), confirmReprint: z.boolean().optional() }).strict();
const paperInput = z.object({ paper: z.enum(['a4', 'long']) }).strict();

type PrintRow = { id: number; from_date: string; to_date: string; first_page: number; last_page: number; printed_at: string };
const pages = (first: number, last: number) => (first === last ? `page ${first}` : `pages ${first} to ${last}`);

export const loosePaper = (db: Db): Paper => (db.prepare("SELECT value FROM prt_settings WHERE key = 'loose_leaf_paper'").pluck().get() as Paper | undefined) ?? 'a4';

/** Prints of a book and year still in force: not covered by a later print of the same book and year. */
function livePrints(db: Db, book: BirBook, year: number): PrintRow[] {
  const all = db.prepare('SELECT id, from_date, to_date, first_page, last_page, printed_at FROM prt_book_prints WHERE book = ? AND year = ? ORDER BY id').all(book, year) as PrintRow[];
  return all.filter((p, i) => !all.slice(i + 1).some((later) => later.from_date <= p.to_date && later.to_date >= p.from_date));
}

export function bookPrintRoutes(app: FastifyInstance, { db, clock, practice }: AppDeps): void {
  const profileOrThrow = () => {
    const profile = db.prepare('SELECT * FROM prt_company_profile WHERE id = 1').get() as Profile | undefined;
    if (!profile) throw conflict('COMPANY_PROFILE_REQUIRED', 'An owner must complete the company profile before printing.');
    return profile;
  };

  app.get('/api/prt/settings', { config: { permission: 'prt.profile.view' } }, async () => ({ looseLeafPaper: loosePaper(db), papers: PAPERS }));
  app.put('/api/prt/settings/loose-leaf-paper', { config: { permission: 'prt.profile.manage' } }, async (req) => {
    const user = currentUser(req);
    requireStepUp(user, clock);
    const { paper } = paperInput.parse(req.body);
    return tx(db, () => {
      const before = loosePaper(db);
      if (before === paper) throw new AppError('NO_CHANGES', 'Nothing changed.', 400);
      const at = stamp(clock);
      db.prepare("UPDATE prt_settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = 'loose_leaf_paper'").run(paper, at, user.userId);
      appendAudit(db, { at, userId: user.userId, action: 'prt.loose_leaf_paper', entityType: 'prt.settings', entityId: 'loose_leaf_paper', data: { from: before, to: paper } });
      return { looseLeafPaper: paper };
    });
  });

  /** The last page printed of each book in a year, and the prints still in force. */
  app.get('/api/prt/books/status', { config: { permission: 'rpt.books.view' } }, async (req) => {
    const raw = (req.query as { year?: string }).year ?? today(clock).slice(0, 4);
    if (!/^\d{4}$/.test(raw)) throw new AppError('BAD_YEAR', 'Pick a year, like 2026.', 400);
    const year = Number(raw);
    return { year, paper: loosePaper(db), books: BIR_BOOKS.map((book) => {
      const prints = livePrints(db, book, year);
      return { book, title: BOOK_TITLES[book], lastPage: prints.reduce((n, p) => Math.max(n, p.last_page), 0),
        prints: prints.map((p) => ({ from: p.from_date, to: p.to_date, firstPage: p.first_page, lastPage: p.last_page, printedAt: p.printed_at })) };
    }) };
  });

  app.post<{ Params: { book: string } }>('/api/prt/books/:book/print', { config: { permission: 'rpt.books.view' } }, async (req) => {
    const user = currentUser(req);
    const book = req.params.book as BirBook;
    if (!BIR_BOOKS.includes(book)) throw notFound('That book');
    const { from, to, confirmReprint } = printInput.parse(req.body);
    if (from > to) throw new AppError('BAD_RANGE', 'The first date must be on or before the last date.', 400);
    if (from.slice(0, 4) !== to.slice(0, 4)) throw new AppError('BOOK_YEAR_SPANS', 'A loose-leaf book is numbered by calendar year. Print one year at a time.', 400);
    const year = Number(from.slice(0, 4));
    return tx(db, () => {
      const profile = profileOrThrow();
      const paper = loosePaper(db);
      const leaf = buildBook(db, book, from, to);
      const live = livePrints(db, book, year);
      const overlaps = live.filter((p) => p.from_date <= to && p.to_date >= from);
      const cut = overlaps.find((p) => p.from_date < from || p.to_date > to);
      if (cut) throw new AppError('PRINT_CUTS_EARLIER', `${BOOK_TITLES[book]} ${cut.from_date} to ${cut.to_date} was printed as ${pages(cut.first_page, cut.last_page)}, and this range cuts across it. Print the whole of that range again, or start after ${cut.to_date}.`, 409, { overlaps });
      const replace = overlaps.length > 0;
      const first = replace ? Math.min(...overlaps.map((p) => p.first_page)) : live.reduce((n, p) => Math.max(n, p.last_page), 0) + 1;
      const layout = layoutBook(leaf, paper, first);
      const last = layout.pages.at(-1)!.number;
      const warnings: string[] = [];
      if (replace) {
        const replaced = `${pages(first, Math.max(...overlaps.map((p) => p.last_page)))}`;
        const collides = live.filter((p) => !overlaps.includes(p) && p.first_page <= last && p.last_page >= first);
        if (collides.length || last !== Math.max(...overlaps.map((p) => p.last_page))) warnings.push(`The new print is ${pages(first, last)}, not ${replaced}. Pages after it may need reprinting so the numbers stay in order.`);
        if (!confirmReprint) {
          throw new AppError('ALREADY_PRINTED', `${BOOK_TITLES[book]} for ${from} to ${to} was already printed (${overlaps.map((p) => `${p.from_date} to ${p.to_date}, ${pages(p.first_page, p.last_page)}, on ${p.printed_at.slice(0, 10)}`).join('; ')}). `
            + `Printing it again replaces ${replaced}: take those pages out of the binder and put in the new ${pages(first, last)}. Print again to confirm.`, 409, { overlaps, firstPage: first, lastPage: last, replacedPages: [first, Math.max(...overlaps.map((p) => p.last_page))], warnings });
        }
      }
      const at = stamp(clock);
      const html = renderLooseLeaf(leaf, layout, { profile, from, to, paper, printedBy: user.displayName, printedAt: at, practice, year });
      db.prepare('INSERT INTO prt_book_prints (book, year, from_date, to_date, first_page, last_page, paper, printed_at, printed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(book, year, from, to, first, last, paper, at, user.userId);
      appendAudit(db, { at, userId: user.userId, action: 'prt.book_print', entityType: 'prt.book', entityId: `${book}:${year}`, data: { book, from, to, firstPage: first, lastPage: last, paper, reprint: replace } });
      return { html, book, year, from, to, paper, firstPage: first, lastPage: last, pageCount: layout.pages.length,
        replacedPages: replace ? [first, Math.max(...overlaps.map((p) => p.last_page))] : null, warnings,
        totals: Object.fromEntries(leaf.keys.map((k, i) => [k, layout.totals[i]]).filter(([, v]) => v !== null)) as Record<string, number>,
        leaves: layout.pages.map((p) => ({ number: p.number, account: p.heading ?? null, rows: p.rows.length,
          broughtForward: p.broughtForward && Object.fromEntries(leaf.keys.map((k, i) => [k, p.broughtForward![i]])),
          carriedForward: Object.fromEntries(leaf.keys.map((k, i) => [k, p.carriedForward[i]])) })) };
    });
  });
}

/** One made-up sample leaf per book for the printer test pack, on the paper the books are set to print on. */
export function testBookPrints(profile: Profile, paper: Paper = 'a4') {
  return BIR_BOOKS.map((book) => {
    const leaf = sampleBook(book);
    return { id: `book-${book}`, label: BOOK_TITLES[book], paper: paper === 'a4' ? 'Loose-leaf, A4' : 'Loose-leaf, long bond',
      html: renderLooseLeaf(leaf, layoutBook(leaf, paper), { profile, from: '2026-09-01', to: '2026-09-30', paper,
        printedBy: 'Sample Owner', printedAt: '2026-09-28T10:00:00+08:00', testPrint: true, year: 2026 }) };
  });
}
