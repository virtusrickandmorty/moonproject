/**
 * Piece rates (PLAN E7 RATE): garment type × operation (a PRD step) × complexity, effective-dated, history kept. A new rate
 * is a new row from today or a later date, so the rate a production entry took never changes under it.
 * Part (the owner's request, Oct 2026): a set is made as an upper and a lower part, each with its own rate; a garment made
 * as one piece is 'whole'.
 */
import { z } from 'zod';
import { badRequest, isBusinessDate } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { COMPLEXITIES, listSteps, type Complexity } from '../PRD/public.ts';

export const MAX_RATE_CENTS = 1_000_000; // ₱10,000 per piece: a typo guard

export const PARTS = ['whole', 'upper', 'lower'] as const;
export type Part = (typeof PARTS)[number];
export interface PieceRate { id: number; garmentType: string; stepCode: string; complexity: Complexity; part: Part; rateCents: number; effectiveFrom: string; reason: string; createdAt: string }

const RATE = `SELECT id, garment_type AS garmentType, step_code AS stepCode, complexity, part, rate_cents AS rateCents, effective_from AS effectiveFrom, reason, created_at AS createdAt
  FROM rate_piece_rates`;

/** The rate in force on a date: the latest effective_from on or before it, the latest row on a tie. Garment types match in any case. */
export function rateAt(db: Db, garmentType: string, stepCode: string, complexity: Complexity, date: string, part: Part = 'whole'): PieceRate | undefined {
  return db
    .prepare(`${RATE} WHERE garment_type = ? AND step_code = ? AND complexity = ? AND part = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1`)
    .get(garmentType.trim(), stepCode, complexity, part, date) as PieceRate | undefined;
}

/** Every rate in force on a date, one per garment type, step, complexity and part. */
export function ratesAt(db: Db, date: string): PieceRate[] {
  return db
    .prepare(
      `${RATE} r WHERE effective_from <= @date AND id = (SELECT x.id FROM rate_piece_rates x WHERE x.garment_type = r.garment_type AND x.step_code = r.step_code
         AND x.complexity = r.complexity AND x.part = r.part AND x.effective_from <= @date ORDER BY x.effective_from DESC, x.id DESC LIMIT 1)
       ORDER BY garment_type, step_code, complexity, part`,
    )
    .all({ date }) as PieceRate[];
}

/** All rows, newest first: the history, rates that start later included. */
export const rateHistory = (db: Db): PieceRate[] => db.prepare(`${RATE} ORDER BY effective_from DESC, id DESC`).all() as PieceRate[];

/** Garment types that have a rate, for the pickers. */
export const garmentTypes = (db: Db): string[] => db.prepare('SELECT DISTINCT garment_type FROM rate_piece_rates ORDER BY garment_type').pluck().all() as string[];

export const rateInput = z
  .object({
    garmentType: z.string().trim().min(1).max(60),
    stepCode: z.string().trim().min(1).max(20),
    complexity: z.enum(COMPLEXITIES),
    part: z.enum(PARTS).optional(), // default whole
    rateCents: z.number().int().min(0).max(MAX_RATE_CENTS),
    effectiveFrom: z.string(),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

/** A new rate from today or a later date (the owner's rate decisions, OWN-05). Call inside a transaction. */
export function addRate(db: Db, raw: unknown, who: { userId: string; at: string; today: string }): PieceRate {
  const parsed = rateInput.safeParse(raw);
  if (!parsed.success) throw badRequest('INVALID_INPUT', 'Some fields are missing or not allowed.', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  const v = parsed.data;
  if (!isBusinessDate(v.effectiveFrom)) throw badRequest('BAD_DATE', 'Enter the date the rate takes effect (YYYY-MM-DD).');
  if (v.effectiveFrom < who.today) throw badRequest('RATE_BACKDATED', 'A rate can change from today or a later date, never an earlier one, so recorded pieces keep the rate they took.');
  if (!listSteps(db).some((s) => s.code === v.stepCode)) throw badRequest('STEP', 'Pick the operation (step) from the list.');
  const known = db.prepare('SELECT garment_type FROM rate_piece_rates WHERE garment_type = ? LIMIT 1').pluck().get(v.garmentType) as string | undefined;
  const garmentType = known ?? v.garmentType; // "polo shirt" joins the existing "Polo shirt"
  const id = Number(
    db
      .prepare('INSERT INTO rate_piece_rates (garment_type, step_code, complexity, part, rate_cents, effective_from, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(garmentType, v.stepCode, v.complexity, v.part ?? 'whole', v.rateCents, v.effectiveFrom, v.reason, who.at, who.userId).lastInsertRowid,
  );
  appendAudit(db, { at: who.at, userId: who.userId, action: 'rate.add', entityType: 'rate.piece_rate', entityId: String(id), data: { ...v, part: v.part ?? 'whole', garmentType } });
  return db.prepare(`${RATE} WHERE id = ?`).get(id) as PieceRate;
}
