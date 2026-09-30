/**
 * The old Google sheet's tabs, read as Google Sheets downloads them (File > Download > CSV, one tab at a time).
 * Each tab is renamed to the importer's own column names before the rows are staged, so everything after the upload
 * (review, dry run, commit) sees one shape whether the file is a tab or an importer file. Columns the plan does not
 * keep (an employee's date of birth, gender, address and phone; who encoded a row and when) are not staged at all.
 */
import { isBusinessDate, manilaDate } from '@moonproject/shared';
import { z } from 'zod';
import { measurementField } from './csv.ts';

export type SheetTab = 'customers' | 'sizes' | 'employees';

const norm = (header: string): string => header.trim().toLowerCase().replace(/\s+/g, ' ');

/** Which tab a file's columns are, or null when it is not one of them (an importer file, or something else). */
export function sheetTabOf(headers: string[]): SheetTab | null {
  const has = new Set(headers.map(norm));
  if (has.has('employee id')) return 'employees';
  if (has.has('size id')) return 'sizes';
  if (has.has('customer id') && has.has('name')) return 'customers';
  return null;
}

/**
 * A date the sheet wrote, as a Manila business date. "2026-02-11" and "2026-02-11 17:57" are Manila wall-clock times and
 * keep their date; a time with an explicit zone ("...T23:30:00Z") is moved to Manila. Anything else comes back as typed,
 * for the review to flag.
 */
export function sheetDate(value: string): string {
  const text = value.trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(text);
  if (!m) return text;
  if (m[3]) {
    const zone = m[3].toUpperCase() === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    const [hh, mm, ss = '00'] = m[2]!.split(':');
    const at = new Date(`${m[1]}T${hh!.padStart(2, '0')}:${mm}:${ss}${zone}`);
    return Number.isNaN(at.getTime()) ? text : manilaDate(at);
  }
  return isBusinessDate(m[1]!) ? m[1]! : text;
}

/** The pay type a Salary Category names: Daily, "Piece Rate (Pakyawan)" or Monthly. Anything else, and blank, is ''. */
export function payTypeOfCategory(category: string): 'daily' | 'piece' | 'monthly' | '' {
  const c = norm(category);
  if (c === 'daily') return 'daily';
  if (c === 'monthly') return 'monthly';
  if (c.startsWith('piece rate') || c.includes('pakyawan')) return 'piece';
  return '';
}

const emailOk = (value: string): boolean => z.email().max(254).safeParse(value).success;

/** One row of a tab, under the importer's column names. */
export function fromSheetRow(raw: Record<string, string>, tab: SheetTab): Record<string, string> {
  const byName = new Map(Object.entries(raw).map(([header, value]) => [norm(header), value]));
  const get = (name: string): string => (byName.get(name) ?? '').trim();
  if (tab === 'customers') {
    const email = get('email address');
    const readable = email === '' || emailOk(email);
    return {
      Legacy_ID: get('customer id'), Customer_Name: get('name'), Email: readable ? email : '',
      Phone: get('contact no.'), Address: get('address'),
      ...(readable ? {} : { Notes: `Email in the old sheet: ${email}` }),
    };
  }
  if (tab === 'sizes') {
    const cells = Object.fromEntries(Object.entries(raw).filter(([header]) => measurementField(header)).map(([h, v]) => [h.trim(), v.trim()]));
    return {
      Measurement_ID: get('size id'), Customer_ID: get('customer id'), Customer_Name: get('customer name'),
      Upper_Size: get('upper size'), Lower_Size: get('lower size'), Remarks: get('remarks'), ...cells,
    };
  }
  const category = get('salary category');
  return {
    Employee_ID: get('employee id'), Employee_Name: get('name'), Position: get('job title'),
    Hire_Date: sheetDate(get('date employed')), Salary_Category: category, Pay_Type: payTypeOfCategory(category), Status: get('status'),
  };
}
