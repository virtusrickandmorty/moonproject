/**
 * CSV files for Excel: UTF-8 with a byte-order mark, CRLF line ends, every cell quoted. A text cell that starts with
 * =, +, -, @, a tab or a carriage return gets a leading apostrophe, so Excel shows it as text and never runs it as a
 * formula (CSV injection); plain numbers such as -150.00 stay numbers.
 */
import { assertCents, type Cents } from './money.ts';

export type CsvCell = string | number | null | undefined;

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: CsvCell): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export const toCsv = (rows: readonly CsvCell[][]): string => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** 1234567 -> "12345.67", -15000 -> "-150.00": pesos for a CSV cell, no separators, worked out in integers. */
export function csvPesos(cents: Cents): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
