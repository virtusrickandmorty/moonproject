/** Making a sizer set, shared by the Sizer sets screen and Import old data (the owner's request, Oct 2026). */
import { AppError, newId } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { szrSetInput } from './schemas.ts';

/** A new set, in the shop. Its code is unique whatever the case. Runs inside the caller's transaction. */
export function createSizerSet(db: Db, raw: unknown, who: { userId: string; at: string }): { id: string; version: number } {
  const input = szrSetInput.parse(raw);
  if (db.prepare('SELECT id FROM szr_sets WHERE code COLLATE NOCASE = ?').get(input.code)) throw new AppError('CODE_EXISTS', `Set code ${input.code} already exists.`, 409);
  const id = newId();
  db.prepare(`INSERT INTO szr_sets (id, code, garment_type, sizes_included, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'in shop', ?, ?)`)
    .run(id, input.code, input.garmentType, input.sizesIncluded, who.at, who.at);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'szr.set.create', entityType: 'szr_sets', entityId: id,
    data: { before: null, after: db.prepare('SELECT * FROM szr_sets WHERE id = ?').get(id) } });
  return { id, version: 1 };
}
