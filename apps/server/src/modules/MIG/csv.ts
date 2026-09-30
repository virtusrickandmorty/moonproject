import { formatPesos, isBusinessDate, parsePesos } from '@moonproject/shared';

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

/** A measurement row with no customer yet: the sheet's MANUAL rows, or a row naming neither a customer nor a group. */
export function isManualMeasurement(raw: Record<string, string>): boolean {
  return raw.Source === 'MANUAL' || raw.Customer_Name === 'MANUAL' || raw.Customer_ID === 'MANUAL'
    || (!raw.Customer_Name && !raw.Customer_ID && !raw.Group_Name);
}

/** What the owner typed for a row: text, pesos in centavos, or a yes for "make this its own customer". */
export type ManualData = Record<string, string | number | boolean>;

/** The name a MANUAL row carries: the wearer's, or the sheet's Customer Name (a person typed in without a customer). Blank when it is only the word MANUAL. */
export function manualName(raw: Record<string, string>): string {
  return [raw.Wearer_Name, raw.Person_Name, raw.Full_Name, raw.Name, raw.Customer_Name]
    .map(v => (v ?? '').trim()).find(v => v !== '' && v.toUpperCase() !== 'MANUAL') ?? '';
}

/** A name with case, spaces and punctuation taken out, so "JUAN  dela-Cruz." and "Juan Dela Cruz" are the same. */
export const nameKey = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Where the owner put a measurement row, laid over the staged values: a staged customer (by legacy ID), a customer already in
 * Moonproject (by id), or a new person-customer named as in the sheet; and a group. A bulk choice also names the wearer.
 * The keys `id:` and `MANUAL:` mark the ones the commit resolves itself. Shared by the review and the commit.
 */
export function applyMeasurementAssignment(raw: Record<string, string>, manual: ManualData): void {
  const text = (v: unknown): string => String(v);
  if (manual.customerLegacyId) { raw.Customer_ID = text(manual.customerLegacyId); raw.Customer_Name = text(manual.customerLegacyId); raw.Source = 'ASSIGNED'; }
  if (manual.groupLegacyId) { raw.Group_ID = text(manual.groupLegacyId); raw.Group_Name = text(manual.groupLegacyId); raw.Source = 'ASSIGNED'; }
  if (manual.customerId) { raw.Customer_ID = `id:${text(manual.customerId)}`; raw.Customer_Name = raw.Customer_ID; raw.Source = 'ASSIGNED'; }
  if (manual.newCustomer) {
    raw.Customer_ID = `MANUAL:${raw.Measurement_ID ?? ''}`;
    raw.Customer_Name = text(manual.wearerName ?? '');
    raw.Source = 'ASSIGNED';
  }
  if (manual.groupId) { raw.Group_ID = `id:${text(manual.groupId)}`; delete raw.Group_Name; }
  if (manual.newGroupName) { raw.Group_Name = text(manual.newGroupName); delete raw.Group_ID; }
  if (manual.wearerName) { raw.Wearer_Name = text(manual.wearerName); raw.Wearer_ID = `manual:${raw.Measurement_ID ?? ''}`; }
}

/** What the owner typed for an employee row, put over the staged values. Shared by the review and the commit. */
export function applyEmployeeFix(raw: Record<string, string>, manual: ManualData): void {
  if (manual.employeeName) raw.Employee_Name = String(manual.employeeName);
  if (manual.legacyId) raw.Employee_ID = String(manual.legacyId);
  if (manual.payType) raw.Pay_Type = String(manual.payType);
  if (manual.hireDate) raw.Hire_Date = String(manual.hireDate);
  if (manual.rateCents !== undefined) {
    // One rate box: the monthly rate for monthly pay, the daily rate otherwise.
    raw[raw.Pay_Type?.trim().toLowerCase() === 'monthly' ? 'Monthly_Rate' : 'Daily_Rate'] = formatPesos(Number(manual.rateCents));
  }
}

const PAY_TYPES = ['daily', 'piece', 'monthly', 'mixed'];

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
    if (isManualMeasurement(raw)) {
      issues.push('Manual measurement row needs to be assigned to a customer or group.');
    }
    const seen = new Set<string>();
    let cells = 0;
    for (const [key, value] of Object.entries(raw)) {
      const field = measurementField(key);
      if (!field) continue;
      if (seen.has(field)) { issues.push(`Measurement column ${field} appears twice.`); continue; }
      seen.add(field);
      try { if (measurementTenths(value) !== null) cells++; } catch { issues.push(`${key} must be a number exact to tenths.`); }
    }
    if (!cells) issues.push('This row has no measurements, so there is nothing to import. Type a measurement with Fix, or exclude the row.');
  }
  if (rowType === 'employee') {
    if (!raw.Employee_Name) issues.push('Employee is missing a name.');
    if (!legacyId) issues.push('Employee is missing a legacy ID.');
    const sheet = raw.Salary_Category !== undefined; // a row of the old sheet's Employees tab
    const payType = (raw.Pay_Type ?? '').trim().toLowerCase();
    if (payType && !PAY_TYPES.includes(payType)) issues.push('Pay type must be daily, piece, monthly or mixed.');
    if (sheet && !payType) {
      issues.push(raw.Salary_Category
        ? `Salary Category "${raw.Salary_Category}" is not Daily, Piece Rate (Pakyawan) or Monthly. Use Fix to choose the pay type.`
        : 'Salary Category is blank. Use Fix to choose the pay type.');
    }
    if (raw.Daily_Rate?.trim()) {
      try { rateCents = rateFromPesos(raw.Daily_Rate); }
      catch { issues.push('Daily rate must be a non-negative peso amount exact to the centavo.'); }
    }
    if (payType === 'monthly') {
      if (!raw.Monthly_Rate?.trim()) issues.push('Monthly pay needs a monthly rate. Use Fix to type it.');
      else try { rateFromPesos(raw.Monthly_Rate); } catch { issues.push('Monthly rate must be a non-negative peso amount exact to the centavo.'); }
    } else if ((payType === 'daily' || payType === 'mixed') && !rateCents && !issues.some(i => i.startsWith('Daily rate'))) {
      issues.push('Daily pay needs a daily rate. Use Fix to type it.');
    }
    if (raw.Hire_Date?.trim() && !isBusinessDate(raw.Hire_Date.trim())) issues.push(`Hire date "${raw.Hire_Date}" is not a date like 2026-02-11. Use Fix to type it.`);
    if (raw.Hire_Date !== undefined && !raw.Hire_Date.trim()) issues.push('Date Employed is blank, so the hire date will be today (requires owner confirmation).');
    if (raw.Status !== undefined && raw.Status.trim().toLowerCase() !== 'active') {
      issues.push(`Status is ${raw.Status.trim() ? `"${raw.Status.trim()}"` : 'blank'}, not Active. Exclude the row, or accept it to bring the employee in as active (requires owner confirmation).`);
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
