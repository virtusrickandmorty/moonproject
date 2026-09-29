import { z } from 'zod';
import { isBusinessDate, parsePesos } from '@moonproject/shared';
import { normalizePhone } from '../CUS/public.ts';

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

/**
 * The old Google sheet's tabs, as File > Download > CSV gives them. Each is read by its own column names and turned into
 * the importer's names on upload; columns Moonproject does not keep (who encoded a row and when, an employee's birth date,
 * gender, address and contact number) are left out, so they are never staged.
 */
export type SheetTab = 'customers' | 'sizes' | 'employees';
export const SHEET_TABS: Record<SheetTab, string> = { customers: 'Customers', sizes: 'Customer Sizes', employees: 'Employees' };
const SHEET_COLUMNS: Record<SheetTab, Record<string, string>> = {
  customers: { 'customer id': 'Legacy_ID', name: 'Customer_Name', 'email address': 'Email', 'contact no.': 'Phone', address: 'Billing_Address' },
  sizes: { 'size id': 'Measurement_ID', 'customer id': 'Customer_ID', 'customer name': 'Customer_Name',
    'upper size': 'Upper_Size', 'lower size': 'Lower_Size', remarks: 'Remarks' },
  employees: { 'employee id': 'Employee_ID', name: 'Employee_Name', 'job title': 'Position', 'salary category': 'Salary_Category',
    status: 'Status', 'date employed': 'Hire_Date' },
};
const PAY_BY_CATEGORY: Record<string, string> = { daily: 'daily', 'piece rate (pakyawan)': 'piece', monthly: 'monthly' };
const headerKey = (h: string): string => h.trim().toLowerCase().replace(/\s+/g, ' ');

/** Which tab of the old sheet a file with these columns is, if any. */
export function sheetTabOf(headers: string[]): SheetTab | null {
  const has = (name: string) => headers.some(h => headerKey(h) === name);
  if (has('size id')) return 'sizes';
  if (has('employee id') || has('salary category')) return 'employees';
  if (has('customer id') && has('name')) return 'customers';
  return null;
}

/** A row of an old-sheet tab under the importer's column names; any other row is returned as it is. */
export function fromSheet(raw: Record<string, string>): Record<string, string> {
  const tab = sheetTabOf(Object.keys(raw));
  if (!tab) return raw;
  const out: Record<string, string> = { Sheet_Tab: SHEET_TABS[tab] };
  for (const [header, value] of Object.entries(raw)) {
    const name = SHEET_COLUMNS[tab][headerKey(header)];
    if (name) out[name] = value;
    else if (tab === 'sizes' && measurementField(header)) out[header] = value;
  }
  if (tab === 'sizes' && out.Customer_Name && out.Customer_Name.toUpperCase() !== 'MANUAL') out.Wearer_Name = out.Customer_Name;
  if (tab === 'employees') {
    const pay = PAY_BY_CATEGORY[headerKey(out.Salary_Category ?? '')];
    if (pay) out.Pay_Type = pay;
  }
  return out;
}

/** The sheet's dates ("2026-02-11" or "2026-02-11 17:57") are Manila dates: the date part is kept, the time dropped. */
export function sheetDate(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(value.trim());
  return m && isBusinessDate(m[1]!) ? m[1]! : null;
}

/** A contact cell may hold several numbers ("0917 123 4567 / 0918 765 4321"); each is normalised to +63. */
export function sheetPhones(value: string): string[] {
  const parts = value.split(/[/,;&]|\s+(?:or|and)\s+/i).map(p => p.trim()).filter(Boolean);
  return [...new Set(parts.map(p => normalizePhone(p)))];
}

/** A measurement row the owner has to give a customer: marked MANUAL, or with no customer at all. */
export function needsCustomer(raw: Record<string, string>): boolean {
  if (raw.Source === 'ASSIGNED') return false;
  return raw.Source === 'MANUAL' || raw.Customer_Name === 'MANUAL' || raw.Customer_ID === 'MANUAL' ||
    (!raw.Customer_ID && !raw.Customer_Name && !raw.Group_Name);
}

/** The measurement's note: the old sheet's sizes and remarks, which have no column of their own. */
export function measurementNote(raw: Record<string, string>): string {
  return [['Upper size', raw.Upper_Size], ['Lower size', raw.Lower_Size], ['Remarks', raw.Remarks]]
    .filter(([, v]) => v?.trim()).map(([label, v]) => `${label}: ${v!.trim()}`).join('. ');
}

/** A row with the owner's fixes applied, as the importer names its columns. Used by review, dry run and commit alike. */
export function applyManual(rowType: string, source: Record<string, string>, manual: Record<string, string | number>): Record<string, string> {
  const raw = { ...source };
  const text = (key: string) => manual[key] === undefined ? undefined : String(manual[key]);
  const clearable = (key: string, column: string) => { const v = text(key); if (v !== undefined) raw[column] = v === '-' ? '' : v; };
  if (rowType === 'customer') {
    if (manual.customerName) raw.Customer_Name = String(manual.customerName);
    if (manual.registeredName) raw.Registered_Name = String(manual.registeredName);
    if (manual.legacyId) raw.Legacy_ID = String(manual.legacyId);
    clearable('email', 'Email');
    clearable('phone', 'Phone');
  } else if (rowType === 'measurement') {
    if (manual.customerLegacyId) {
      raw.Customer_ID = String(manual.customerLegacyId); raw.Customer_Name = String(manual.customerLegacyId); raw.Source = 'ASSIGNED';
    }
    if (manual.groupLegacyId) { raw.Group_ID = String(manual.groupLegacyId); raw.Group_Name = String(manual.groupLegacyId); raw.Source = 'ASSIGNED'; }
    if (manual.wearerName) raw.Wearer_Name = String(manual.wearerName);
    for (const field of measurementFields) {
      if (manual[field] === undefined) continue;
      const oldKey = Object.keys(raw).find(key => measurementField(key) === field);
      raw[oldKey ?? field] = String(manual[field]);
    }
  } else if (rowType === 'employee') {
    if (manual.employeeName) raw.Employee_Name = String(manual.employeeName);
    if (manual.legacyId) raw.Employee_ID = String(manual.legacyId);
    if (manual.payType) raw.Pay_Type = String(manual.payType);
    if (manual.hireDate) raw.Hire_Date = String(manual.hireDate);
    if (manual.rateCents !== undefined) {
      raw[raw.Pay_Type === 'monthly' ? 'Monthly_Rate' : 'Daily_Rate'] = (Number(manual.rateCents) / 100).toFixed(2);
    }
  } else if (rowType === 'piece_rate') {
    if (manual.garmentType) raw.Garment_Type = String(manual.garmentType);
    if (manual.operation) raw.Operation = String(manual.operation);
    if (manual.rateCents !== undefined) raw.Rate = (Number(manual.rateCents) / 100).toFixed(2);
  }
  return raw;
}

export function rowTypeOf(raw: Record<string, string>): RowType {
  const keys = Object.keys(raw);
  const tab = sheetTabOf(keys);
  if (tab) return tab === 'customers' ? 'customer' : tab === 'sizes' ? 'measurement' : 'employee';
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
    if (raw.Email?.trim() && !z.email().safeParse(raw.Email.trim()).success) issues.push(`Email "${raw.Email.trim()}" is not an email address.`);
    if (raw.Phone?.trim()) {
      try { sheetPhones(raw.Phone); }
      catch { issues.push(`Phone "${raw.Phone.trim()}" is not a Philippine phone number with 9 or 10 digits.`); }
    }
    if ((raw.Billing_Address?.trim().length ?? 0) > 500) issues.push('Address is longer than 500 characters.');
  }
  if (rowType === 'measurement') {
    if (!legacyId) issues.push('Measurement is missing a legacy ID.');
    if (needsCustomer(raw)) issues.push('Manual measurement row needs to be assigned to a customer or group.');
    const seen = new Set<string>();
    let measured = 0;
    for (const [key, value] of Object.entries(raw)) {
      const field = measurementField(key);
      if (!field) continue;
      if (seen.has(field)) { issues.push(`Measurement column ${field} appears twice.`); continue; }
      seen.add(field);
      let tenths: number | null = null;
      try { tenths = measurementTenths(value); } catch { issues.push(`${key} must be a number exact to tenths.`); continue; }
      if (tenths === null) continue;
      if (tenths === 0 || tenths > 3000) issues.push(`${key} must be more than 0 and at most 300.`);
      measured++;
    }
    if (!measured && !issues.some(i => i.includes('exact to tenths'))) issues.push('Measurement row has no measurements.');
    if (measurementNote(raw).length > 500) issues.push('Upper size, lower size and remarks together are longer than 500 characters.');
  }
  if (rowType === 'employee') {
    if (!raw.Employee_Name) issues.push('Employee is missing a name.');
    if (!legacyId) issues.push('Employee is missing a legacy ID.');
    const payType = raw.Pay_Type?.trim().toLowerCase() ?? '';
    const monthly = payType === 'monthly';
    const rateText = (monthly ? raw.Monthly_Rate : raw.Daily_Rate)?.trim();
    let badRate = false;
    if (rateText) {
      try { rateCents = rateFromPesos(rateText); }
      catch { badRate = true; issues.push(`${monthly ? 'Monthly' : 'Daily'} rate must be a non-negative peso amount exact to the centavo.`); }
    }
    if (raw.Sheet_Tab && !payType) {
      issues.push(raw.Salary_Category?.trim()
        ? `Salary Category "${raw.Salary_Category.trim()}" is not Daily, Piece Rate (Pakyawan) or Monthly: choose the pay type.`
        : 'Salary Category is blank: choose the pay type.');
    } else if (payType && !['daily', 'piece', 'monthly', 'mixed'].includes(payType)) issues.push(`Pay type "${raw.Pay_Type}" is not daily, piece, monthly or mixed.`);
    else if (payType && payType !== 'piece' && !rateCents && !badRate) issues.push(`Employee needs a ${monthly ? 'monthly' : 'daily'} rate.`);
    if (raw.Hire_Date?.trim() && !sheetDate(raw.Hire_Date)) issues.push(`Hire date "${raw.Hire_Date.trim()}" is not a date like 2026-02-11.`);
    if ((raw.Position?.trim().length ?? 0) > 60) issues.push('Job title is longer than 60 characters.');
    if (raw.Status?.trim() && raw.Status.trim().toLowerCase() !== 'active') issues.push(`Employee status "${raw.Status.trim()}" requires owner confirmation.`);
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
