import { parsePesos } from '@moonproject/shared';

export type RowType = 'customer' | 'measurement' | 'employee' | 'piece_rate' | 'unknown';
export interface ParsedRow {
  rowType: RowType;
  raw: Record<string, string>;
  issues: string[];
  status: 'valid' | 'needs_review';
  legacyId: string | null;
  rateCents: number | null;
}

export const measurementFields = [
  'shoulder', 'chest', 'upper_waist', 'collar', 'bust_point', 'figure_point',
  'bust_distance', 'arm_hole', 'sleeve_hole', 'sleeve_length', 'upper_length',
  'lower_waist', 'hips', 'crotch', 'thigh', 'calf', 'ankle', 'lower_length',
] as const;
export type MeasurementField = typeof measurementFields[number];
const measurementSet = new Set<string>(measurementFields);

/** The source calls sleeve length "Sleeve Height"; all other E1 names also accept spaces/case. */
export function measurementField(header: string): MeasurementField | null {
  const key = header.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const mapped = key === 'sleeve_height' ? 'sleeve_length' : key;
  return measurementSet.has(mapped) ? mapped as MeasurementField : null;
}

/** Exact tenths, with a dash or empty cell representing no measurement. */
export function measurementTenths(value: string): number | null {
  const s = value.trim();
  if (s === '' || s === '-') return null;
  const match = /^(\d+)(?:\.(\d))?$/.exec(s);
  if (!match) throw new Error('Measurement must be a non-negative number exact to tenths.');
  const tenths = Number(match[1]) * 10 + Number(match[2] ?? '0');
  if (!Number.isSafeInteger(tenths)) throw new Error('Measurement is too large.');
  return tenths;
}

export function rateFromPesos(value: string): number {
  const cents = parsePesos(value);
  if (cents < 0) throw new Error('Rate cannot be negative.');
  return cents;
}

/** CSV parser supporting quoted newlines and reporting each data row's source line. */
export function parseCSV(csvText: string): { objects: Record<string, string>[]; lineNumbers: number[] } {
  const rows: string[][] = [];
  const lineNumbers: number[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const next = csvText[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else { cell += char; if (char === '\n') line++; }
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') i++;
      row.push(cell); rows.push(row); lineNumbers.push(rowStart);
      row = []; cell = ''; line++; rowStart = line;
    } else cell += char;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted cell.');
  if (cell || row.length) { row.push(cell); rows.push(row); lineNumbers.push(rowStart); }
  if (!rows.length) return { objects: [], lineNumbers: [] };
  const headers = rows[0]!.map(h => h.trim());
  const objects: Record<string, string>[] = [];
  const starts: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]!;
    if (values.every(v => !v.trim())) continue;
    const obj: Record<string, string> = {};
    headers.forEach((header, j) => { if (header) obj[header] = values[j]?.trim() ?? ''; });
    objects.push(obj); starts.push(lineNumbers[i]!);
  }
  return { objects, lineNumbers: starts };
}

export function rowTypeOf(raw: Record<string, string>): RowType {
  const keys = Object.keys(raw);
  if (keys.includes('Measurement_ID') || keys.some(k => measurementField(k))) return 'measurement';
  if (keys.includes('Employee_ID') || keys.includes('Employee_Name') || keys.includes('Daily_Rate') || keys.includes('Pay_Type')) return 'employee';
  if (keys.includes('Customer_Name') || keys.includes('Registered_Name') || keys.includes('TIN') || keys.includes('Email')) return 'customer';
  if (keys.includes('Garment_Type') && keys.includes('Operation') && keys.includes('Rate')) return 'piece_rate';
  return 'unknown';
}

export function validateRow(raw: Record<string, string>): ParsedRow {
  const rowType = rowTypeOf(raw);
  const issues: string[] = [];
  const legacyId = (rowType === 'customer' ? raw.Legacy_ID || raw.Customer_ID
    : rowType === 'employee' ? raw.Employee_ID || raw.Legacy_ID
    : rowType === 'measurement' ? raw.Measurement_ID : null) || null;
  let rateCents: number | null = null;
  if (rowType === 'unknown') issues.push('Could not determine row type from columns.');
  if (rowType === 'customer') {
    if (!raw.Customer_Name && !raw.Registered_Name) issues.push('Customer is missing a name.');
    if (!legacyId) issues.push('Customer is missing a legacy ID.');
  }
  if (rowType === 'measurement') {
    if (!legacyId) issues.push('Measurement is missing a legacy ID.');
    if (raw.Source === 'MANUAL' || raw.Customer_Name === 'MANUAL' || (!raw.Customer_Name && !raw.Group_Name)) {
      issues.push('Manual measurement row needs to be assigned to a customer or group.');
    }
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(raw)) {
      const field = measurementField(key);
      if (!field) continue;
      if (seen.has(field)) { issues.push(`Measurement column ${field} appears twice.`); continue; }
      seen.add(field);
      try { measurementTenths(value); } catch { issues.push(`${key} must be a number exact to tenths.`); }
    }
  }
  if (rowType === 'employee') {
    if (!raw.Employee_Name) issues.push('Employee is missing a name.');
    if (!legacyId) issues.push('Employee is missing a legacy ID.');
    if (raw.Daily_Rate?.trim()) {
      try { rateCents = rateFromPesos(raw.Daily_Rate); }
      catch { issues.push('Daily rate must be a non-negative peso amount exact to the centavo.'); }
    }
    issues.push('Employee rate or missing rate requires owner confirmation.');
  }
  if (rowType === 'piece_rate') {
    if (!raw.Garment_Type || !raw.Operation) issues.push('Piece rate needs a garment type and operation.');
    try { rateCents = rateFromPesos(raw.Rate ?? ''); }
    catch { issues.push('Piece rate must be a non-negative peso amount exact to the centavo.'); }
    issues.push('Piece rate seed requires owner confirmation.');
  }
  return { rowType, raw, issues, status: issues.length ? 'needs_review' : 'valid', legacyId, rateCents };
}

/** Keys scoped by type avoid merging unrelated customers and employees with the same ID. */
export function duplicateKeys(row: ParsedRow): string[] {
  const keys: string[] = [];
  if (row.legacyId) keys.push(`${row.rowType}:id:${row.legacyId.trim().toLowerCase()}`);
  if (row.rowType === 'customer' && row.raw.Customer_Name?.trim() && row.raw.TIN?.trim()) {
    keys.push(`customer:name-tin:${row.raw.Customer_Name.trim().toLowerCase()}:${row.raw.TIN.trim().toLowerCase()}`);
  }
  return keys;
}
