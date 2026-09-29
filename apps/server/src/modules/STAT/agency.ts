/**
 * Agency upload files (PLAN E11): the month's SSS contributions list (R3 / e-collection layout), PhilHealth list
 * (RF-1 / EPRS layout) and Pag-IBIG list (MCRF / eSRS layout) as CSV files the owner uploads on the agency's site. They
 * are cut from the same figures as the screens' lists (lists.ts monthLists), so each file's rows and total are the
 * list's. Nothing is posted. The agencies change their templates: every column below is the accountant's to check
 * against the template in force (they are listed in the pull request). SSS and Pag-IBIG loan amortizations are their own
 * collection lists and are not in these files.
 *
 * The file is refused, with a plain message, when the employer's number at the agency is not set or an employee on the
 * list has no ID number. The employer numbers live in stat_employer_numbers (the company profile holds the TIN only).
 */
import { AppError, badRequest, csvPesos, toCsv, type CsvCell } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { monthLists, type MonthLists } from './lists.ts';

export const UPLOAD_SCHEMES = ['SSS', 'PHIC', 'HDMF'] as const;
export type UploadScheme = (typeof UPLOAD_SCHEMES)[number];
export const isUploadScheme = (s: string): s is UploadScheme => (UPLOAD_SCHEMES as readonly string[]).includes(s);

/** What the file is, its name for staff, the employer's number and the employee's ID as the agency calls them, and its columns. */
export const UPLOAD: Record<UploadScheme, { label: string; layout: string; employerLabel: string; idLabel: string; file: string; columns: string[] }> = {
  SSS: {
    label: 'SSS', layout: 'R3 / e-collection contribution list', employerLabel: 'SSS employer number', idLabel: 'SSS number', file: 'SSS-contributions',
    columns: ['Employer Number', 'Applicable Month', 'SS Number', 'Employee Name', 'Monthly Salary Credit', 'Of Which MPF', 'Employee Share', 'Employer Share', 'EC', 'Total'],
  },
  PHIC: {
    label: 'PhilHealth', layout: 'RF-1 / EPRS contribution list', employerLabel: 'PhilHealth employer number (PEN)', idLabel: 'PhilHealth number (PIN)', file: 'PhilHealth-contributions',
    columns: ['Employer Number', 'Applicable Month', 'PhilHealth Number', 'Employee Name', 'Monthly Basic Salary', 'Employee Share', 'Employer Share', 'Total'],
  },
  HDMF: {
    label: 'Pag-IBIG', layout: 'MCRF / eSRS contribution list', employerLabel: 'Pag-IBIG employer ID', idLabel: 'Pag-IBIG MID number', file: 'PagIBIG-contributions',
    columns: ['Employer Number', 'Period Covered', 'Pag-IBIG MID Number', 'Employee Name', 'Monthly Compensation', 'Employee Share', 'Employer Share', 'Total'],
  },
};

export interface EmployerNumber { number: string; since: string }

/** The employer's number at each agency in force now, or null where none is set. */
export function employerNumbers(db: Db): Record<UploadScheme, EmployerNumber | null> {
  const out = { SSS: null, PHIC: null, HDMF: null } as Record<UploadScheme, EmployerNumber | null>;
  for (const s of UPLOAD_SCHEMES) {
    out[s] = (db.prepare('SELECT number, created_at AS since FROM stat_employer_numbers WHERE scheme = ? ORDER BY id DESC LIMIT 1').get(s) as EmployerNumber | undefined) ?? null;
  }
  return out;
}

/** A new employer number for a scheme (the old one stays as history). Returns false when it is already the one in force. */
export function setEmployerNumber(db: Db, scheme: UploadScheme, number: string, userId: string, at: string): boolean {
  if (employerNumbers(db)[scheme]?.number === number) return false;
  db.prepare('INSERT INTO stat_employer_numbers (scheme, number, created_at, created_by) VALUES (?, ?, ?, ?)').run(scheme, number, at, userId);
  return true;
}

export interface Upload { scheme: UploadScheme; month: string; filename: string; rows: number; totalCents: number; csv: string }

const period = (month: string) => `${month.slice(5)}${month.slice(0, 4)}`; // 2026-09 -> 092026

/** The upload file of a scheme and month, or a plain refusal (AppError 400 or 422). */
export function buildUpload(db: Db, month: string, scheme: UploadScheme): Upload {
  const u = UPLOAD[scheme];
  const lists = monthLists(db, month, true);
  const list = lists[scheme === 'SSS' ? 'sss' : scheme === 'PHIC' ? 'phic' : 'hdmf'];
  if (!list.rows.length) throw badRequest('NOTHING_TO_UPLOAD', `No ${u.label} contribution is recorded for ${month}, so there is nothing to upload.`);
  const employer = employerNumbers(db)[scheme];
  if (!employer) throw new AppError('EMPLOYER_NUMBER_MISSING', `Type the ${u.employerLabel} first, then download the ${u.label} file again.`, 422);
  const missing = list.rows.filter((r) => !r.idNo?.trim());
  if (missing.length) {
    throw new AppError('ID_NUMBER_MISSING', `The ${u.label} file for ${month} was not made: no ${u.idLabel} for ${missing.map((r) => `${r.name} (${r.code})`).join(', ')}. Add the number on the employee record, then download it again.`, 422, {
      employees: missing.map((r) => ({ employeeId: r.employeeId, code: r.code, name: r.name })),
    });
  }
  const head: CsvCell[] = u.columns;
  let body: CsvCell[][];
  if (scheme === 'SSS') {
    body = (lists.sss.rows).map((r) => [employer.number, period(month), r.idNo, r.name, csvPesos(r.mscCents), csvPesos(r.mpfMscCents), csvPesos(r.eeCents), csvPesos(r.erCents), csvPesos(r.ecCents), csvPesos(r.totalCents)]);
  } else if (scheme === 'PHIC') {
    body = lists.phic.rows.map((r) => [employer.number, period(month), r.idNo, r.name, csvPesos(r.basisCents), csvPesos(r.eeCents), csvPesos(r.erCents), csvPesos(r.totalCents)]);
  } else {
    body = lists.hdmf.rows.map((r) => [employer.number, period(month), r.idNo, r.name, csvPesos(r.compensationCents), csvPesos(r.eeCents), csvPesos(r.erCents), csvPesos(r.totalCents)]);
  }
  return { scheme, month, filename: `${u.file}-${month}.csv`, rows: body.length, totalCents: list.totalCents, csv: toCsv([head, ...body]) };
}

export type { MonthLists };
