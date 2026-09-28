import { describe, expect, it } from 'vitest';
import { csvCell, csvPesos, toCsv } from './csv.ts';

describe('csv', () => {
  it('quotes every cell and doubles quotes inside', () => {
    expect(toCsv([['Name', 'Memo'], ['Sample "Co."', null]])).toBe('﻿"Name","Memo"\r\n"Sample ""Co.""",""\r\n');
  });

  it('keeps text that looks like a formula from running in Excel, but leaves numbers alone', () => {
    expect(['=HYPERLINK("x")', '+63 917', '-SUM(A1)', '@cmd', '\tx'].map(csvCell)).toEqual(['"\'=HYPERLINK(""x"")"', '"\'+63 917"', '"\'-SUM(A1)"', '"\'@cmd"', '"\'\tx"']);
    expect([csvCell('-150.00'), csvCell(-15), csvCell('12.5')]).toEqual(['"-150.00"', '"-15"', '"12.5"']);
  });

  it('writes pesos from centavos without separators or floating point', () => {
    expect([csvPesos(1_234_567), csvPesos(-15_000), csvPesos(5), csvPesos(0), csvPesos(100_000_000_00)]).toEqual(['12345.67', '-150.00', '0.05', '0.00', '100000000.00']);
  });
});
