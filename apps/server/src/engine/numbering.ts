/**
 * Gapless, continuous number series (PLAN D7, NR-5). Allocate only inside the posting transaction:
 * if the transaction rolls back, the number is not used.
 */
import type { Db } from '../platform/db/driver.ts';

export interface SeriesDef {
  key: string;
  prefix: string;
  pad?: number;
}

export function ensureSeries(db: Db, s: SeriesDef): void {
  db.prepare('INSERT OR IGNORE INTO number_series (series_key, prefix, next_value, pad) VALUES (?, ?, 1, ?)').run(
    s.key,
    s.prefix,
    s.pad ?? 6,
  );
}

export function allocateNumber(db: Db, seriesKey: string): string {
  if (!db.inTransaction) throw new Error('allocateNumber must run inside the posting transaction');
  const r = db
    .prepare('UPDATE number_series SET next_value = next_value + 1 WHERE series_key = ? RETURNING next_value - 1 AS n, prefix, pad')
    .get(seriesKey) as { n: number; prefix: string; pad: number } | undefined;
  if (!r) throw new Error(`Unknown number series ${seriesKey}`);
  return r.prefix + String(r.n).padStart(r.pad, '0');
}
