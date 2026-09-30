/** The 2316 screen's rules: which years to offer, and the form's items in order. Pure, so they are tested without a browser. */
import type { Figures2316 } from '../../api.ts';

/** This year and the two before, from the server's Manila time ("2027-01-05T09:00:00.000+08:00" -> [2027, 2026, 2025]). */
export const yearsToPick = (serverTime: string): number[] => {
  const y = Number(serverTime.slice(0, 4));
  return [y, y - 1, y - 2];
};

type Item = [no: string, label: string, key: keyof Figures2316];
/** BIR Form 2316 (January 2018) parts IV-A and IV-B, by item number. */
export const ITEMS_2316: [part: string, items: Item[]][] = [
  ['Part IV-A Summary', [
    ['19', 'Gross compensation income from present employer', 'i19GrossCents'],
    ['20', 'Less: total non-taxable/exempt compensation income from present employer', 'i20NonTaxableCents'],
    ['21', 'Taxable compensation income from present employer', 'i21TaxableCents'],
    ['22', 'Add: taxable compensation income from previous employer', 'i22PreviousTaxableCents'],
    ['23', 'Gross taxable compensation income', 'i23GrossTaxableCents'],
    ['24', 'Tax due', 'i24TaxDueCents'],
    ['25A', 'Amount of taxes withheld: present employer', 'i25aPresentWithheldCents'],
    ['25B', 'Amount of taxes withheld: previous employer', 'i25bPreviousWithheldCents'],
    ['26', 'Total amount of taxes withheld as adjusted', 'i26WithheldCents'],
  ]],
  ['Part IV-B A. Non-taxable/exempt compensation income', [
    ['29', 'Basic salary (including the exempt ₱250,000 and below) or statutory minimum wage of the MWE', 'i29BasicSmwCents'],
    ['30', 'Holiday pay (MWE)', 'i30HolidayMweCents'],
    ['31', 'Overtime pay (MWE)', 'i31OvertimeMweCents'],
    ['32', 'Night shift differential (MWE)', 'i32NightMweCents'],
    ['33', 'Hazard pay (MWE)', 'i33HazardMweCents'],
    ['34', '13th month pay and other benefits (up to ₱90,000)', 'i34BenefitsCents'],
    ['35', 'De minimis benefits', 'i35DeMinimisCents'],
    ['36', 'SSS, GSIS, PHIC and Pag-IBIG contributions and union dues (employee share)', 'i36SharesCents'],
    ['37', 'Salaries and other forms of compensation', 'i37OtherNonTaxableCents'],
    ['38', 'Total non-taxable/exempt compensation income', 'i38NonTaxableCents'],
  ]],
  ['Part IV-B B. Taxable compensation income', [
    ['39', 'Basic salary', 'i39BasicCents'],
    ['48', 'Taxable 13th month benefits', 'i48TaxableBenefitsCents'],
    ['50', 'Overtime pay', 'i50OvertimeCents'],
    ['51', 'Others (allowances and adjustments)', 'i51OtherCents'],
    ['52', 'Total taxable compensation income', 'i52TaxableCents'],
  ]],
];
