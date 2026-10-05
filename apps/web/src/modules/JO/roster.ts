/**
 * Roster grid helpers (PLAN E4): paste rows straight from Excel (tab-separated: name, size, jersey name,
 * jersey number, qty) and match the names to the wearers pulled from the customer's group. Pure, so it is
 * tested without a browser; the server checks every row again when the job order is recorded.
 */

/** A row from GET /api/jo/groups/:id/roster. */
export interface PulledWearer { personId: string; wearerName: string; sizeMode: 'preset' | 'measured'; jerseyName?: string; jerseyNumber?: string }
export interface GridRow { personId?: string; name?: string; wearerName: string; sizeMode: 'preset' | 'measured'; size?: string; jerseyName?: string; jerseyNumber?: string; qty: number }

const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function parseRosterPaste(text: string, wearers: PulledWearer[] = []): { rows: GridRow[]; errors: string[] } {
  const byName = new Map(wearers.map((w) => [key(w.wearerName), w]));
  const rows: GridRow[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const [name = '', size = '', jerseyName = '', jerseyNumber = '', qty = ''] = line.split('\t').map((c) => c.trim());
    if (!line.trim() || (i === 0 && /^(name|wearer)\b/i.test(name))) return; // blank line or header row
    if (!name) return void errors.push(`Row ${i + 1}: the name is empty.`);
    if (qty && !(Number.isInteger(Number(qty)) && Number(qty) >= 1 && Number(qty) <= 1000)) return void errors.push(`Row ${i + 1}: the quantity must be a whole number like 1 or 2.`);
    const w = byName.get(key(name));
    const jersey = jerseyName || w?.jerseyName;
    const number = jerseyNumber || w?.jerseyNumber;
    rows.push({
      ...(w ? { personId: w.personId, wearerName: w.wearerName } : { name, wearerName: name }),
      sizeMode: size ? 'preset' : (w?.sizeMode ?? 'preset'), // a typed size wins over measurements
      ...(size ? { size: size.toUpperCase() } : {}),
      ...(jersey ? { jerseyName: jersey.toUpperCase() } : {}),
      ...(number ? { jerseyNumber: number } : {}),
      qty: qty ? Number(qty) : 1,
    });
  });
  return { rows, errors };
}

/** Grid row -> the server's roster input (the display name of a listed wearer is not sent). */
export const toRosterInput = ({ wearerName: _, ...row }: GridRow) => row;
export const rosterPieces = (rows: { qty: number }[]) => rows.reduce((s, r) => s + r.qty, 0);
