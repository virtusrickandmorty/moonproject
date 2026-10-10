/**
 * Production carried over when a job order is edited (the owner's request, Oct 2026). An edit cancels the job order and
 * records a replacement (NR-4); each item of the replacement is paired with the old item it was, and keeps that item's
 * production: its route, step status and rework are copied onto it, and the pieces and wearers recorded on the old item
 * count on it through prd_carry_overs (the views prd_line_assignments and prd_line_assignment_wearers). The recorded
 * entries stay as they are, so nothing is paid twice. The owner's rules: an item or wearer left out of the edit keeps its
 * work on record as extras; a wearer whose size or jersey changed after work keeps the progress, with a warning.
 */
import { newId } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { lineState, rosterPeopleOf } from '../JO/public.ts';
import { lineRoute, lineSetup, syncStage, type Who } from './production.ts';

export interface CarryWearer { rowNo: number; personId: string | null; name: string; size: string | null; jerseyName: string | null; jerseyNumber: string | null; qty: number }
export interface CarryLine { lineNo: number; kind: string; description: string; qty: number; roster: CarryWearer[] }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const lineKey = (l: CarryLine) => `${l.kind}|${norm(l.description)}`;

/** A recorded job order's items with their wearers. */
export function carryLinesOf(db: Db, jobOrderId: string): CarryLine[] {
  return lineState(db, jobOrderId).map((l) => ({
    lineNo: l.lineNo, kind: l.kind, description: l.description, qty: l.qty,
    roster: rosterPeopleOf(db, jobOrderId, l.lineNo).map((w) => ({ rowNo: w.rowNo, personId: w.personId, name: w.wearerName, size: w.size, jerseyName: w.jerseyName, jerseyNumber: w.jerseyNumber, qty: w.qty })),
  }));
}

/**
 * Pairs the edited items with the old ones (new line → old line): the same kind and description, in order; then, between
 * those, the rest by position when it is plainly the same item with its description changed: the same kind and a wearer
 * in common, or no wearers on either and the same pieces. Items keep their order in the form, so this follows an edit that
 * changes, adds or leaves out items; an item swapped for another is left out (its work kept as extras), never carried on.
 */
export function matchLines(old: CarryLine[], next: CarryLine[]): Map<number, number> {
  const pairs: [number, number][] = [];
  let from = 0;
  next.forEach((n, i) => {
    const j = old.findIndex((o, k) => k >= from && lineKey(o) === lineKey(n));
    if (j >= 0) (pairs.push([i, j]), (from = j + 1));
  });
  const out = new Map<number, number>(pairs);
  const anchors: [number, number][] = [[-1, -1], ...pairs, [next.length, old.length]];
  for (let a = 0; a < anchors.length - 1; a++) {
    const [ni, oi] = anchors[a]!;
    const [nj, oj] = anchors[a + 1]!;
    let o = oi + 1;
    for (let n = ni + 1; n < nj; n++) {
      while (o < oj && !renamed(old[o]!, next[n]!)) o++;
      if (o < oj) out.set(n, o++);
    }
  }
  return new Map([...out].map(([n, o]) => [next[n]!.lineNo, old[o]!.lineNo]));
}

const renamed = (o: CarryLine, n: CarryLine) => o.kind === n.kind
  && (o.roster.length === 0 && n.roster.length === 0 ? o.qty === n.qty : matchWearers(o.roster, n.roster).size > 0);

/** Pairs an item's wearers (new row → old row): the same customer's wearer, else the same name. */
export function matchWearers(old: CarryWearer[], next: CarryWearer[]): Map<number, number> {
  const out = new Map<number, number>();
  const used = new Set<number>();
  const pass = (same: (o: CarryWearer, n: CarryWearer) => boolean) => {
    for (const n of next) {
      if (out.has(n.rowNo)) continue;
      const o = old.find((w) => !used.has(w.rowNo) && same(w, n));
      if (o) (out.set(n.rowNo, o.rowNo), used.add(o.rowNo));
    }
  };
  pass((o, n) => !!o.personId && o.personId === n.personId);
  pass((o, n) => !!norm(o.name) && norm(o.name) === norm(n.name));
  return out;
}

/** The furthest step each wearer of a line was ticked on (roster row → step name). */
function wearerSteps(db: Db, jobOrderId: string, lineNo: number): Map<number, string> {
  const rows = db.prepare(`SELECT x.roster_row_no AS rowNo, s.name FROM prd_line_assignment_wearers x JOIN prd_assignments a ON a.id = x.assignment_id
    JOIN documents d ON d.id = a.document_id JOIN prd_steps s ON s.id = a.step_id
    WHERE x.jo = ? AND x.line = ? AND d.status = 'posted' AND a.kind IN ('work', 'rework') ORDER BY s.seq`).all(jobOrderId, lineNo) as { rowNo: number; name: string }[];
  return new Map(rows.map((r) => [r.rowNo, r.name]));
}

/** The most pieces a line has on any step, and the furthest step with pieces. */
function lineWork(db: Db, jobOrderId: string, lineNo: number): { made: number; step: string } | null {
  const route = lineRoute(db, jobOrderId, lineNo);
  const worked = (route ?? []).filter((s) => s.pieces > 0 || s.reworkPieces > 0);
  if (worked.length === 0) return null;
  return { made: Math.max(...worked.map((s) => s.pieces)), step: worked[worked.length - 1]!.name };
}

const changes = (o: CarryWearer, n: CarryWearer) => [
  norm(o.size) !== norm(n.size) && `size from ${o.size ?? 'measured'} to ${n.size ?? 'measured'}`,
  norm(o.jerseyName) !== norm(n.jerseyName) && `jersey name from ${o.jerseyName ?? 'none'} to ${n.jerseyName ?? 'none'}`,
  norm(o.jerseyNumber) !== norm(n.jerseyNumber) && `jersey number from ${o.jerseyNumber ?? 'none'} to ${n.jerseyNumber ?? 'none'}`,
].filter((c): c is string => !!c);

/**
 * What an edit does to the production of a job order (shown before it is recorded): the items and wearers with work that
 * are left out (kept as extras), items going below the pieces already made, and wearers whose size or jersey changes
 * after work (keep the progress; send back for rework if needed).
 */
export function carryWarnings(db: Db, jobOrderId: string, next: CarryLine[]): string[] {
  const old = carryLinesOf(db, jobOrderId);
  const pairs = matchLines(old, next);
  const newOf = new Map([...pairs].map(([n, o]) => [o, n]));
  const out: string[] = [];
  for (const o of old) {
    const work = lineWork(db, jobOrderId, o.lineNo);
    if (!work) continue;
    const n = next.find((l) => l.lineNo === newOf.get(o.lineNo));
    if (!n) {
      out.push(`${o.description} is left out, but ${work.made} ${work.made === 1 ? 'piece has' : 'pieces have'} gone through ${work.step}. ${work.made === 1 ? 'It stays' : 'They stay'} on record as extras.`);
      continue;
    }
    if (n.qty < work.made) out.push(`Item ${n.lineNo} (${n.description}) goes down to ${n.qty} pieces, but ${work.made} have gone through ${work.step}. The extra stay on record.`);
    const ticked = wearerSteps(db, jobOrderId, o.lineNo);
    const wearers = matchWearers(o.roster, n.roster);
    const oldOf = new Map([...wearers].map(([nr, or]) => [or, nr]));
    for (const w of o.roster) {
      const step = ticked.get(w.rowNo);
      if (!step) continue;
      const nw = n.roster.find((x) => x.rowNo === oldOf.get(w.rowNo));
      if (!nw) out.push(`Item ${n.lineNo}: ${w.name} is left out, but their piece has gone through ${step}. It stays on record as an extra.`);
      else for (const c of changes(w, nw)) out.push(`Item ${n.lineNo}: ${w.name}'s ${c} after ${step}. The progress is kept: send it back for rework if it needs redoing.`);
    }
  }
  return out;
}

/**
 * Runs inside the edit (relinkOnReissue of the job order): pairs the items, links them (and the items the old one was
 * carried over from) with their wearers, copies each item's route, step status and rework, and moves the job's stage on.
 */
export function carryProductionOver(db: Db, oldId: string, newId_: string): void {
  const old = carryLinesOf(db, oldId);
  const next = carryLinesOf(db, newId_);
  const pairs = matchLines(old, next);
  const by = db.prepare('SELECT number, cancelled_by AS userId, cancelled_at AS at FROM documents WHERE id = ?').get(oldId) as { number: string; userId: string; at: string };
  const who: Who = { userId: by.userId, at: by.at };
  const link = db.prepare('INSERT INTO prd_carry_overs (job_order_id, line_no, from_job_order_id, from_line_no) VALUES (?, ?, ?, ?)');
  const linkWearer = db.prepare('INSERT INTO prd_carry_over_wearers (job_order_id, line_no, from_job_order_id, from_line_no, from_row_no, row_no) VALUES (?, ?, ?, ?, ?, ?)');
  const earlier = db.prepare('SELECT from_job_order_id AS jo, from_line_no AS line FROM prd_carry_overs WHERE job_order_id = ? AND line_no = ?');
  const earlierWearers = db.prepare('SELECT from_row_no AS fromRow, row_no AS row FROM prd_carry_over_wearers WHERE job_order_id = ? AND line_no = ? AND from_job_order_id = ? AND from_line_no = ?');
  const carried: { lineNo: number; fromLineNo: number }[] = [];
  for (const [n, o] of pairs) {
    const setup = lineSetup(db, oldId, o);
    if (!setup) continue; // not routed yet: nothing to carry
    const wearers = matchWearers(old.find((l) => l.lineNo === o)!.roster, next.find((l) => l.lineNo === n)!.roster);
    const newRow = new Map([...wearers].map(([nr, or]) => [or, nr]));
    link.run(newId_, n, oldId, o);
    for (const [or, nr] of newRow) linkWearer.run(newId_, n, oldId, o, or, nr);
    for (const e of earlier.all(oldId, o) as { jo: string; line: number }[]) {
      link.run(newId_, n, e.jo, e.line);
      for (const w of earlierWearers.all(oldId, o, e.jo, e.line) as { fromRow: number; row: number }[]) {
        const nr = newRow.get(w.row);
        if (nr !== undefined) linkWearer.run(newId_, n, e.jo, e.line, w.fromRow, nr);
      }
    }
    // The route and step status as they stand, as the item's first rows.
    db.prepare('INSERT INTO prd_line_setups (job_order_id, line_no, seq, template_id, garment_type, complexity, is_set, at, user_id) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)').run(
      newId_, n, setup.templateId, setup.garmentType, setup.complexity, setup.isSet ? 1 : 0, who.at, who.userId,
    );
    for (const id of setup.stepIds) {
      db.prepare('INSERT INTO prd_line_setup_steps (job_order_id, line_no, seq, step_id) VALUES (?, ?, 1, ?)').run(newId_, n, id);
      const ev = db.prepare('SELECT action, reason, at, user_id AS userId FROM prd_step_events WHERE job_order_id = ? AND line_no = ? AND step_id = ? ORDER BY seq DESC LIMIT 1').get(oldId, o, id) as
        { action: string; reason: string | null; at: string; userId: string } | undefined;
      if (ev) db.prepare('INSERT INTO prd_step_events (job_order_id, line_no, step_id, seq, action, reason, at, user_id) VALUES (?, ?, ?, 1, ?, ?, ?, ?)').run(newId_, n, id, ev.action, ev.reason, ev.at, ev.userId);
    }
    // Rework sent back, with its wearers as rows of the new item (one left out is not carried).
    const reworks = db.prepare('SELECT id, step_id AS stepId, part, pieces, reason, at, user_id AS userId FROM prd_reworks WHERE job_order_id = ? AND line_no = ? ORDER BY at').all(oldId, o) as
      { id: string; stepId: number; part: string; pieces: number; reason: string; at: string; userId: string }[];
    for (const r of reworks) {
      const id = newId();
      db.prepare('INSERT INTO prd_reworks (id, job_order_id, line_no, step_id, part, pieces, reason, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, newId_, n, r.stepId, r.part, r.pieces, r.reason, r.at, r.userId);
      for (const w of db.prepare('SELECT roster_row_no FROM prd_rework_wearers WHERE rework_id = ?').pluck().all(r.id) as number[]) {
        const nr = newRow.get(w);
        if (nr !== undefined) db.prepare('INSERT INTO prd_rework_wearers (rework_id, roster_row_no) VALUES (?, ?)').run(id, nr);
      }
    }
    carried.push({ lineNo: n, fromLineNo: o });
  }
  if (carried.length === 0) return;
  appendAudit(db, { at: who.at, userId: who.userId, action: 'prd.carry_over', entityType: 'jo.job_order', entityId: newId_, data: { from: oldId, lines: carried } });
  syncStage(db, newId_, `Production carried over from ${by.number}`, who);
}
