/**
 * The 1604-C alphalist (PLAN F4, D8 "Yearly"): schedule 1, employees other than minimum wage earners, and schedule 2,
 * minimum wage earners, each row from the employee's 2316 data (year-end.ts), in the column order of the BIR's 1604-C
 * schedules (January 2018 form). Columns this app has no data for (nationality, employment status, reason of
 * separation) are left blank for the accountant to fill in the BIR Alphalist Data Entry module.
 */
import { csvPesos, type CsvCell } from '@moonproject/shared';
import type { Data2316 } from './year-end.ts';

const LEAD = ['Seq no.', 'TIN', 'Name of employee', 'Nationality / resident', 'Current employment status', 'Employed from', 'Employed to', 'Reason of separation'];
const TAIL = [
  'Taxable compensation income, previous employer', 'Total taxable compensation income (present and previous)', 'Tax due (Jan-Dec)',
  'Tax withheld (Jan-Nov), previous employer', 'Tax withheld (Jan-Nov), present employer', 'Year-end adjustment: amount withheld and paid for in December',
  'Year-end adjustment: over-withheld tax refunded to employee', 'Amount of tax withheld as adjusted', 'Substituted filing (Yes/No)',
];
export const SCHEDULE_1 = [
  ...LEAD, 'Gross compensation income, present employer',
  'Non-taxable: 13th month pay and other benefits', 'Non-taxable: de minimis benefits', 'Non-taxable: SSS, GSIS, PHIC and Pag-IBIG contributions and union dues',
  'Non-taxable: salaries and other forms of compensation', 'Total non-taxable/exempt compensation income',
  'Taxable: basic salary', 'Taxable: 13th month pay and other benefits', 'Taxable: salaries and other forms of compensation', 'Total taxable compensation income, present employer',
  ...TAIL,
];
export const SCHEDULE_2 = [
  ...LEAD, 'Gross compensation income, present employer',
  'Statutory minimum wage per day', 'Statutory minimum wage per month', 'Statutory minimum wage per year', 'Factor used (days a year)',
  'Non-taxable: basic salary / statutory minimum wage (paid)', 'Non-taxable: holiday pay', 'Non-taxable: overtime pay', 'Non-taxable: night shift differential', 'Non-taxable: hazard pay',
  'Non-taxable: 13th month pay and other benefits', 'Non-taxable: de minimis benefits', 'Non-taxable: SSS, GSIS, PHIC and Pag-IBIG contributions and union dues',
  'Non-taxable: salaries and other forms of compensation', 'Total non-taxable/exempt compensation income',
  'Taxable: 13th month pay and other benefits', 'Taxable: salaries and other forms of compensation', 'Total taxable compensation income, present employer',
  ...TAIL,
];

/** One alphalist row as numbers and text (pesos as centavos); the CSV writes pesos. */
export type AlphaRow = CsvCell[];

function lead(d: Data2316, seq: number): AlphaRow {
  return [seq, d.tin ?? '', d.name, '', '', d.periodFrom, d.periodTo, ''];
}
function tail(d: Data2316): AlphaRow {
  const f = d.figures;
  return [
    f.i22PreviousTaxableCents, f.i23GrossTaxableCents, f.i24TaxDueCents, f.i25bPreviousWithheldCents, f.withheldJanNovCents, f.withheldDecemberCents, f.refundedCents,
    f.i26WithheldCents, d.substitutedFiling ? 'Yes' : 'No',
  ];
}

export function schedule1Row(d: Data2316, seq: number): AlphaRow {
  const f = d.figures;
  return [
    ...lead(d, seq), f.i19GrossCents, f.i34BenefitsCents, f.i35DeMinimisCents, f.i36SharesCents,
    f.i29BasicSmwCents + f.i30HolidayMweCents + f.i31OvertimeMweCents + f.i32NightMweCents + f.i33HazardMweCents + f.i37OtherNonTaxableCents, f.i38NonTaxableCents,
    f.i39BasicCents, f.i48TaxableBenefitsCents, f.i50OvertimeCents + f.i51OtherCents, f.i52TaxableCents, ...tail(d),
  ];
}

export function schedule2Row(d: Data2316, seq: number): AlphaRow {
  const f = d.figures;
  return [
    ...lead(d, seq), f.i19GrossCents, d.smw?.perDayCents ?? 0, d.smw?.perMonthCents ?? 0, d.smw?.perYearCents ?? 0, d.smw ? String(d.smw.factor) : '',
    f.i29BasicSmwCents, f.i30HolidayMweCents, f.i31OvertimeMweCents, f.i32NightMweCents, f.i33HazardMweCents, f.i34BenefitsCents, f.i35DeMinimisCents, f.i36SharesCents,
    f.i37OtherNonTaxableCents, f.i38NonTaxableCents, f.i48TaxableBenefitsCents, f.i39BasicCents + f.i50OvertimeCents + f.i51OtherCents, f.i52TaxableCents, ...tail(d),
  ];
}

/** Money columns of a schedule (every column after the lead that is a number), as pesos for the CSV. */
export const asCsv = (row: AlphaRow): CsvCell[] => row.map((c, i) => (i >= LEAD.length && typeof c === 'number' ? csvPesos(c) : c));

export function alphalist(rows: Data2316[]) {
  const s1 = rows.filter((d) => !d.isMwe);
  const s2 = rows.filter((d) => d.isMwe);
  return { schedule1: s1.map((d, i) => schedule1Row(d, i + 1)), schedule2: s2.map((d, i) => schedule2Row(d, i + 1)) };
}
