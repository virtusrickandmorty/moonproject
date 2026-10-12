/** Cash to prepare for a payroll release: bills largest first, coins for what is under ₱20, and the totals. */
import { expect, it } from 'vitest';
import { addUp, breakdown, denomination } from './cash.ts';

it('counts an amount out in the fewest bills, then coins', () => {
  const b = breakdown(1_844_31); // ₱1,844.31
  expect(b.bills).toEqual({ 100000: 1, 50000: 1, 20000: 1, 10000: 1, 5000: 0, 2000: 2 });
  expect(b.coinCents).toBe(431); // ₱4.31
  expect(b.coins).toEqual({ 2000: 0, 1000: 0, 500: 0, 100: 4, 25: 1, 5: 1, 1: 1 });
  expect(breakdown(2_055_34).bills).toEqual({ 100000: 2, 50000: 0, 20000: 0, 10000: 0, 5000: 1, 2000: 0 });
  expect(breakdown(0).coinCents).toBe(0);
  expect(breakdown(-5).coinCents).toBe(0);
});

it('adds the envelopes up for the withdrawal, and prints a denomination', () => {
  const t = addUp([breakdown(1_844_31), breakdown(2_055_34)]);
  expect(t.bills[100000]).toBe(3);
  expect(t.bills[2000]).toBe(2);
  expect(t.coinCents).toBe(431 + 534);
  expect([denomination(100000), denomination(2000), denomination(25)]).toEqual(['₱1,000', '₱20', '25¢']);
});
