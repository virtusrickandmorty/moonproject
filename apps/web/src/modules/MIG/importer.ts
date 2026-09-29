/**
 * The importer screens' rules (PLAN E13 MIG-01): what each kind of file holds, a row's status and problems in plain words,
 * what each row button may do and what a fix sends, the counts, and the dry-run and commit results in words. Pure, so they
 * are tested without a browser. The server decides everything that matters (row status, duplicates, checksums); nothing
 * here posts or recomputes a figure the server reports.
 */
import { formatPeso, formatPesos, parsePesos } from '@moonproject/shared';
import type { DryRunResult, MigCommitResult, MigRow, MigRowStatus, MigRowType, MigUpload } from '../../api.ts';

/** The four kinds of file the importer takes. The server reads the kind from the columns; the screen checks it before sending. */
export type MigKind = Exclude<MigRowType, 'unknown'>;
export const KINDS: { kind: MigKind; label: string; columns: string; holds: string }[] = [
  { kind: 'customer', label: 'Customers', holds: 'customers and their details',
    columns: 'the old sheet\'s Customers tab as downloaded (Customer ID, Name, Email Address, Contact No., Address), or Legacy_ID, Customer_Name (also Registered_Name, TIN, Email, Phone, Billing_Address)' },
  { kind: 'measurement', label: 'Measurements', holds: 'the measurement sheet',
    columns: 'the old sheet\'s Customer Sizes tab as downloaded (Size ID, Customer ID, Customer Name, Upper Size, Shoulder to Lower Length, Lower Size, Remarks), or Measurement_ID, Customer_ID, Customer_Name, Wearer_Name, Group_Name, then Shoulder, Chest and the other measurement columns' },
  { kind: 'employee', label: 'Employees', holds: 'employees and their pay',
    columns: 'the old sheet\'s Employees tab as downloaded (Employee ID, Name, Job Title, Salary Category, Status, Date Employed), or Employee_ID, Employee_Name, Daily_Rate' },
  { kind: 'piece_rate', label: 'Piece rates', columns: 'Garment_Type, Operation, Rate', holds: 'the piece-rate list' },
];

/** The old Google sheet's tabs the importer reads as downloaded (MIG/csv.ts `sheetTabOf`, same rules; a test keeps them in step). */
export type SheetTab = 'customers' | 'sizes' | 'employees';
export const SHEET_TABS: Record<SheetTab, { label: string; kind: MigKind }> = {
  customers: { label: 'Customers', kind: 'customer' }, sizes: { label: 'Customer Sizes', kind: 'measurement' }, employees: { label: 'Employees', kind: 'employee' },
};
export function sheetTabOf(headers: string[]): SheetTab | null {
  const has = (name: string) => headers.some((h) => h.trim().toLowerCase().replace(/\s+/g, ' ') === name);
  if (has('size id')) return 'sizes';
  if (has('employee id') || has('salary category')) return 'employees';
  if (has('customer id') && has('name')) return 'customers';
  return null;
}
/** "the Customers tab of the old sheet" for a file downloaded from it; null for any other file. */
export function fileLooksLike(csv: string): string | null {
  const tab = sheetTabOf(headerOf(csv));
  return tab && `the ${SHEET_TABS[tab].label} tab of the old sheet`;
}
export const kindLabel = (kind: MigRowType): string => KINDS.find((k) => k.kind === kind)?.label ?? 'Unknown';
const ROW_WORDS: Record<MigRowType, string> = { customer: 'Customer', measurement: 'Measurements', employee: 'Employee', piece_rate: 'Piece rate', unknown: 'Unknown' };
export const rowTypeWords = (t: MigRowType): string => ROW_WORDS[t];

/** The 18 measurement columns, as the server names them (MIG/csv.ts `measurementFields`; a test keeps the two lists equal). */
export const MEASUREMENT_FIELDS = [
  'shoulder', 'chest', 'upper_waist', 'collar', 'bust_point', 'figure_point', 'bust_distance', 'arm_hole', 'sleeve_hole', 'sleeve_length',
  'upper_length', 'lower_waist', 'hips', 'crotch', 'thigh', 'calf', 'ankle', 'lower_length',
] as const;
const measurementSet = new Set<string>(MEASUREMENT_FIELDS);
/** "Sleeve Height" is the old sheet's name for sleeve length; case, spaces and dashes do not matter. */
export function measurementKey(header: string): string | null {
  const key = header.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const mapped = key === 'sleeve_height' ? 'sleeve_length' : key;
  return measurementSet.has(mapped) ? mapped : null;
}
const measurementWords = (field: string) => field.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/* ---- the upload form ---- */

/** A spreadsheet's "Save as CSV" often starts with a byte-order mark that would spoil the first column name. */
export const cleanCsv = (text: string): string => text.replace(/^﻿/, '');

/** The column names of the first line, quotes handled. */
export function headerOf(csv: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  const text = cleanCsv(csv);
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"', i++);
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') (cells.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') break;
    else cell += c;
  }
  cells.push(cell);
  return cells.map((h) => h.trim()).filter(Boolean);
}

/** What the server will read a file with these columns as (MIG/csv.ts `rowTypeOf`, same order). */
export function kindOfHeader(headers: string[]): MigRowType {
  const tab = sheetTabOf(headers);
  if (tab) return SHEET_TABS[tab].kind;
  const has = (k: string) => headers.includes(k);
  if (has('Measurement_ID') || headers.some((h) => measurementKey(h))) return 'measurement';
  if (has('Employee_ID') || has('Employee_Name') || has('Daily_Rate') || has('Pay_Type')) return 'employee';
  if (has('Customer_Name') || has('Registered_Name') || has('TIN') || has('Email')) return 'customer';
  if (has('Garment_Type') && has('Operation') && has('Rate')) return 'piece_rate';
  return 'unknown';
}

/** A plain-words problem when the file is not the kind picked (or is empty); null when it may be sent. */
export function fileProblem(kind: MigKind | '', filename: string, csv: string): string | null {
  if (!kind) return 'Pick what the file holds.';
  if (!filename) return 'Pick the CSV file.';
  if (!cleanCsv(csv).trim()) return 'The file is empty.';
  const found = kindOfHeader(headerOf(csv));
  const wanted = KINDS.find((k) => k.kind === kind)!;
  if (found === 'unknown') return `Moonproject cannot tell what this file holds from its first line. ${wanted.label} need these columns: ${wanted.columns}.`;
  const looks = fileLooksLike(csv) ?? kindLabel(found).toLowerCase();
  if (found !== kind) return `This file looks like ${looks}, not ${wanted.label.toLowerCase()}. Pick ${kindLabel(found)}, or choose another file.`;
  return null;
}

/** The body of POST /api/mig/upload. The kind is not sent: the server reads it from the columns. */
export const uploadRequest = (filename: string, csv: string): { filename: string; csv: string } => ({ filename, csv: cleanCsv(csv) });

/* ---- the uploads list ---- */

const UPLOAD_WORDS: Record<MigUpload['status'], string> = { staged: 'Waiting for review', dry_run_passed: 'Waiting for review', committed: 'Imported' };
export const uploadStatusWords = (s: MigUpload['status']): string => UPLOAD_WORDS[s];
/** A committed upload has no rows to review any more: its page shows the result. */
export const isOpen = (u: Pick<MigUpload, 'status'>): boolean => u.status !== 'committed';

/* ---- a row ---- */

const ROW_STATUS_WORDS: Record<MigRowStatus, string> = {
  needs_review: 'Needs review', accepted: 'Accepted', excluded: 'Excluded', merged: 'Merged into another row', valid: 'Nothing wrong',
};
export const rowStatusWords = (s: MigRowStatus): string => ROW_STATUS_WORDS[s];

const CONFIRM_ISSUE = /requires owner confirmation/;
const DUPLICATE_ISSUE = /^Possible duplicate of row (\d+) \(([^)]+)\)\.?$/;

/** The server's problem, in words for the owner: the internal row id of a duplicate is left out, the confirmations say what to do. */
export function issueWords(issue: string): string {
  const dup = DUPLICATE_ISSUE.exec(issue);
  if (dup) return `Possible duplicate of row ${dup[1]}. Merge the two, or leave one out.`;
  if (/^Employee rate or missing rate/.test(issue)) return 'The owner must confirm this employee\'s pay type and rate before it goes in.';
  const status = /^Employee status "(.*)" requires owner confirmation\.$/.exec(issue);
  if (status) return `The old sheet says this employee is "${status[1]}", not Active. Exclude the row to leave them out, or accept it to add them as working.`;
  if (/^Employee needs a (daily|monthly) rate/.test(issue)) return `${issue.replace(/\.$/, '')}: type it with Fix.`;
  if (/: choose the pay type\.$/.test(issue)) return issue.replace(/\.$/, ' with Fix.');
  if (/^(Email|Phone) ".*" is not/.test(issue)) return `${issue} Fix it, or type - with Fix to leave it out.`;
  if (/^Piece rate seed/.test(issue)) return 'The owner must confirm this piece rate before it goes in.';
  return issue;
}

/** Problems that only a fix can clear: the server refuses to accept the row as it is while any is left. */
export const blockingIssues = (issues: string[]): string[] => issues.filter((i) => !CONFIRM_ISSUE.test(i) && !DUPLICATE_ISSUE.test(i));

/** The other rows the server flagged as this row's duplicates, still in play and of the same kind. Merging needs one of these. */
export function mergeCandidates(row: MigRow, rows: MigRow[]): MigRow[] {
  const ids = new Set(row.issues.map((i) => DUPLICATE_ISSUE.exec(i)?.[2]).filter((id): id is string => !!id));
  return rows.filter((r) => ids.has(r.id) && r.id !== row.id && r.rowType === row.rowType && (r.status === 'needs_review' || r.status === 'accepted'));
}

/** A row that other rows were merged into: it cannot be merged or left out until they are. */
export const isSurvivor = (row: MigRow, rows: MigRow[]): boolean => rows.some((r) => r.status === 'merged' && r.mergeIntoRowId === row.id);

export interface RowButtons { accept: boolean; fix: boolean; merge: boolean; exclude: boolean }
/** Which buttons a row offers, by the same rules the server checks. The server still has the last word. */
export function rowButtons(row: MigRow, rows: MigRow[]): RowButtons {
  const pending = row.status === 'needs_review';
  const survivor = isSurvivor(row, rows);
  return {
    accept: pending && blockingIssues(row.issues).length === 0,
    fix: pending,
    merge: (pending || row.status === 'accepted') && !survivor && mergeCandidates(row, rows).length > 0,
    exclude: (pending || row.status === 'accepted' || row.status === 'valid') && !survivor,
  };
}

/** One line naming the row: "Example Academy (C-100)". Shows the fix if there was one. */
export function rowTitle(row: MigRow): string {
  const raw = row.raw;
  const m = row.manualData ?? {};
  const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
  const id = row.legacyId ? ` (${row.legacyId})` : '';
  if (row.rowType === 'customer') return `${text(m.customerName) || raw.Customer_Name || text(m.registeredName) || raw.Registered_Name || 'No name'}${id}`;
  if (row.rowType === 'employee') return `${text(m.employeeName) || raw.Employee_Name || 'No name'}${id}`;
  if (row.rowType === 'piece_rate') return `${text(m.garmentType) || raw.Garment_Type || '?'}, ${text(m.operation) || raw.Operation || '?'}`;
  if (row.rowType === 'measurement') {
    const who = raw.Wearer_Name || raw.Person_Name || raw.Full_Name || raw.Name;
    return `${who ?? 'Measurements'}${id}`;
  }
  return 'Unknown row';
}

/** What the review should say about rows from the old sheet's tabs: what is kept where, and what is not kept. */
export function sheetNotes(rows: MigRow[]): string[] {
  const tabs = new Set(rows.map((r) => r.raw.Sheet_Tab).filter(Boolean));
  const notes: string[] = [];
  if (tabs.has('Customers')) notes.push('From the Customers tab: Contact No. is kept as the customer\'s phone (a cell with several numbers gives several phones), Address as the billing address. Date Encoded, Encoded By, Date Updated and Updated By are not kept.');
  if (tabs.has('Customer Sizes')) notes.push('From the Customer Sizes tab: each row goes to the customer with the same Customer ID, and Upper Size, Lower Size and Remarks go into the measurement\'s note.');
  if (tabs.has('Employees')) notes.push('From the Employees tab: Date of Birth, Gender, Address and Contact No. are not kept (Moonproject does not keep them). Job Title is kept as the position and Date Employed as the hire date. The old sheet has no rates: type each daily or monthly rate with Fix; piece-rate workers need none.');
  return notes;
}

/** Every field of the old row as label and value, for the "All fields" view. Empty cells are left out. */
export const rowFields = (row: MigRow): [label: string, value: string][] => Object.entries(row.raw).filter(([, v]) => v !== '').map(([k, v]) => [k, v]);

/* ---- the counts ---- */

export interface RowCounts { listed: number; needsReview: number; accepted: number; excluded: number; merged: number }
export function rowCounts(rows: MigRow[]): RowCounts {
  const n = (s: MigRowStatus) => rows.filter((r) => r.status === s).length;
  return { listed: rows.length, needsReview: n('needs_review'), accepted: n('accepted'), excluded: n('excluded'), merged: n('merged') };
}
/** The four statuses cover every listed row: a row with any other status would be missing from the counts. */
export const countsAddUp = (c: RowCounts): boolean => c.needsReview + c.accepted + c.excluded + c.merged === c.listed;
/** The dry run and the commit are refused while any row still needs review. */
export const reviewDone = (c: RowCounts): boolean => c.needsReview === 0;
const rowsWord = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;
/** "accepted 7 + excluded 1 + merged 1 = 9 rows listed" once nothing is left; before that, what is left. */
export function countsWords(c: RowCounts): string {
  if (!reviewDone(c)) return `${rowsWord(c.listed)} listed: ${c.needsReview} still to review, ${c.accepted} accepted, ${c.excluded} excluded, ${c.merged} merged.`;
  return `Accepted ${c.accepted} + excluded ${c.excluded} + merged ${c.merged} = ${rowsWord(c.listed)} listed.`;
}

export type StatusFilter = 'all' | 'needs_review' | 'accepted' | 'excluded' | 'merged';
export const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'needs_review', label: 'Needs review' }, { key: 'accepted', label: 'Accepted' },
  { key: 'excluded', label: 'Excluded' }, { key: 'merged', label: 'Merged' },
];
export const filterRows = (all: MigRow[], filter: StatusFilter): MigRow[] => (filter === 'all' ? all : all.filter((r) => r.status === filter));
export const filterCount = (c: RowCounts, filter: StatusFilter): number =>
  ({ all: c.listed, needs_review: c.needsReview, accepted: c.accepted, excluded: c.excluded, merged: c.merged })[filter];
/** Open on what is left to do; when nothing is, on everything. */
export const startFilter = (c: RowCounts): StatusFilter => (c.needsReview > 0 ? 'needs_review' : 'all');

/* ---- fix ---- */

export interface FixField { key: string; label: string; kind: 'text' | 'peso' | 'tenths' | 'choice'; hint?: string; choices?: string[] }
const measurementFields: FixField[] = MEASUREMENT_FIELDS.map((key) => ({ key, label: measurementWords(key), kind: 'tenths' }));
export const FIX_FIELDS: Record<MigKind, FixField[]> = {
  customer: [
    { key: 'customerName', label: 'Customer name', kind: 'text' },
    { key: 'registeredName', label: 'Registered name', kind: 'text' },
    { key: 'legacyId', label: 'Legacy ID', kind: 'text' },
    { key: 'email', label: 'Email', kind: 'text', hint: 'Type - to leave it out.' },
    { key: 'phone', label: 'Phone', kind: 'text', hint: 'Several numbers may be split with /. Type - to leave it out.' },
  ],
  measurement: [
    { key: 'customerLegacyId', label: 'Customer (legacy ID)', kind: 'text', hint: 'The legacy ID of a customer in a customers upload that is still waiting for review.' },
    { key: 'groupLegacyId', label: 'Group', kind: 'text', hint: 'Needs the customer above.' },
    { key: 'wearerName', label: 'Wearer\'s name', kind: 'text', hint: 'Left empty, the customer is the wearer.' },
    ...measurementFields,
  ],
  employee: [
    { key: 'employeeName', label: 'Employee name', kind: 'text' },
    { key: 'legacyId', label: 'Legacy ID', kind: 'text' },
    { key: 'payType', label: 'Pay type', kind: 'choice', choices: ['daily', 'piece', 'monthly'] },
    { key: 'rateCents', label: 'Rate (pesos)', kind: 'peso', hint: 'The daily rate, or the monthly rate for monthly pay. Piece pay has none.' },
    { key: 'hireDate', label: 'Hire date', kind: 'text', hint: 'Like 2026-02-11.' },
  ],
  piece_rate: [
    { key: 'garmentType', label: 'Garment type', kind: 'text' },
    { key: 'operation', label: 'Operation', kind: 'text' },
    { key: 'rateCents', label: 'Rate (pesos)', kind: 'peso' },
  ],
};
export const fixFieldsOf = (row: Pick<MigRow, 'rowType'>): FixField[] => (row.rowType === 'unknown' ? [] : FIX_FIELDS[row.rowType]);

/** The value a field has now, as text: what the fix form starts with. Assignments start empty (they are for what is missing). */
export function currentValue(row: MigRow, key: string): string {
  const raw = row.raw;
  const m = row.manualData ?? {};
  if (m[key] !== undefined) return key === 'rateCents' ? formatPesos(Number(m[key])) : String(m[key]);
  if (key === 'customerLegacyId' || key === 'groupLegacyId') return '';
  if (key === 'rateCents') return row.rateCents === null ? '' : formatPesos(row.rateCents);
  if (key === 'legacyId') return row.legacyId ?? '';
  if (key === 'customerName') return raw.Customer_Name ?? '';
  if (key === 'registeredName') return raw.Registered_Name ?? '';
  if (key === 'employeeName') return raw.Employee_Name ?? '';
  if (key === 'garmentType') return raw.Garment_Type ?? '';
  if (key === 'operation') return raw.Operation ?? '';
  if (key === 'email') return raw.Email ?? '';
  if (key === 'phone') return raw.Phone ?? '';
  if (key === 'wearerName') return raw.Wearer_Name ?? '';
  if (key === 'payType') return raw.Pay_Type ?? '';
  if (key === 'hireDate') return raw.Hire_Date ?? '';
  const header = Object.keys(raw).find((h) => measurementKey(h) === key);
  return header ? (raw[header] ?? '') : '';
}
export const fixStart = (row: MigRow): Record<string, string> => Object.fromEntries(fixFieldsOf(row).map((f) => [f.key, currentValue(row, f.key)]));

/** Whether this measurement row still has to be given a customer (the server refuses to accept it until it is). */
const needsCustomer = (row: MigRow): boolean => row.rowType === 'measurement' && row.issues.some((i) => /needs to be assigned/.test(i));

export type FixResult = { ok: true; manualData: Record<string, string | number> } | { ok: false; message: string };
/**
 * What "Save fix" sends: only the fields the owner changed, as the server's manual-data schema names them (pesos become
 * centavos here, measurements stay text exact to tenths). Nothing changed, or a value the server would refuse, is a message.
 */
export function fixBody(row: MigRow, edits: Record<string, string>): FixResult {
  const manualData: Record<string, string | number> = {};
  for (const f of fixFieldsOf(row)) {
    const text = (edits[f.key] ?? '').trim();
    if (text === '' || text === currentValue(row, f.key).trim()) continue;
    if (f.kind === 'peso') {
      let cents: number;
      try { cents = parsePesos(text); } catch { return { ok: false, message: `${f.label}: type a peso amount such as 650.50.` }; }
      if (cents < 0) return { ok: false, message: `${f.label} cannot be negative.` };
      manualData[f.key] = cents;
    } else if (f.kind === 'tenths') {
      if (!/^(\d+(\.\d)?|-)$/.test(text)) return { ok: false, message: `${f.label}: type a number to one decimal place such as 15.2, or - for no measurement.` };
      manualData[f.key] = text;
    } else manualData[f.key] = text;
  }
  if (manualData.groupLegacyId && !manualData.customerLegacyId) return { ok: false, message: 'Type the customer\'s legacy ID with the group.' };
  if (needsCustomer(row) && !manualData.customerLegacyId) return { ok: false, message: 'This measurement is not assigned to a customer yet. Type the customer\'s legacy ID.' };
  if (Object.keys(manualData).length === 0) return { ok: false, message: 'Nothing was changed. Change a field, or go back and accept the row as it is.' };
  return { ok: true, manualData };
}

/* ---- dry run, commit, clear ---- */

export const cellSumWords = (tenths: number): string => `${Math.floor(tenths / 10).toLocaleString('en-US')}.${tenths % 10}`;
export const shortHash = (sha256: string): string => sha256.slice(0, 12);

/** The dry run's counts as label and figure, in the order of the sheet. */
export function dryRunLines(r: DryRunResult): [label: string, value: string][] {
  const c = r.counts;
  return [
    ['Customers to import', String(c.customers)], ['Measurement rows to import', String(c.measurements)], ['Employees to import', String(c.employees)],
    ['Piece rates to import', String(c.pieceRates)], ['Left out (excluded)', String(c.excluded)], ['Merged into another row', String(c.merged)], ['Rows in the file', String(c.total)],
  ];
}
/** Every row of the file is counted once: imported by kind, excluded or merged. */
export const dryRunAddsUp = (r: DryRunResult): boolean => {
  const c = r.counts;
  return c.customers + c.measurements + c.employees + c.pieceRates + c.excluded + c.merged === c.total;
};
/** The checks to compare against the old sheet: the measurement cells (e.g. 30,122.0) and the rate totals. */
export function dryRunChecks(r: DryRunResult): [label: string, value: string][] {
  const k = r.checksums;
  return [
    ['Measurement cells add up to', cellSumWords(k.measurement.cellTenths)],
    ['Employee rates add up to', formatPeso(k.employee.rateCents)],
    ['Piece rates add up to', formatPeso(k.pieceRate.rateCents)],
    ['Customers, fingerprint', shortHash(k.customer.sha256)],
    ['Measurements, fingerprint', shortHash(k.measurement.sha256)],
    ['Employees, fingerprint', shortHash(k.employee.sha256)],
    ['Piece rates, fingerprint', shortHash(k.pieceRate.sha256)],
  ];
}
/** What "Commit" sends: the measurement total the owner saw in the dry run. The server checks it again and refuses if it differs. */
export const commitRequest = (dry: DryRunResult): { expectedMeasurementCellTenths: number } => ({ expectedMeasurementCellTenths: dry.checksums.measurement.cellTenths });
/** A dry run stands only while nothing was reviewed after it, and only the owner with mig.commit may commit. */
export const canCommit = (dry: DryRunResult | null, c: RowCounts, mayCommit: boolean): boolean => !!dry && dryRunAddsUp(dry) && reviewDone(c) && mayCommit;

const COMMIT_KINDS: [keyof MigCommitResult['counts'], string][] = [
  ['customer', 'Customers'], ['group', 'Groups'], ['wearer', 'Wearers'], ['measurement', 'Measurements'], ['employee', 'Employees'], ['piece_rate', 'Piece rates'],
];
/** Each kind's line of the commit result. "Already imported" rows were in an earlier upload and are not created twice. */
export function commitLines(r: MigCommitResult): [label: string, value: string][] {
  return COMMIT_KINDS.map(([k, label]) => {
    const { imported, alreadyImported } = r.counts[k];
    return [label, alreadyImported ? `${imported} imported, ${alreadyImported} already imported before` : `${imported} imported`];
  });
}
export const clearedWords = (rowsCleared: number): string => `The raw values of ${rowsWord(rowsCleared)} were cleared from staging.`;
