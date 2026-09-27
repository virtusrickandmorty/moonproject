import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocate, applyRate, formatPeso, parsePesos, vatFromGross } from './money.ts';
import { manilaDate, manilaTimestamp } from './dates.ts';

describe('money', () => {
  it('computes VAT from a VAT-inclusive gross (PLAN D4.1 examples)', () => {
    expect(vatFromGross(5_600_000, 1200)).toEqual({ netCents: 5_000_000, vatCents: 600_000 });
    expect(vatFromGross(99_900, 1200)).toEqual({ netCents: 89_196, vatCents: 10_704 });
    expect(vatFromGross(35_000, 1200)).toEqual({ netCents: 31_250, vatCents: 3_750 });
    expect(vatFromGross(4_000_000, 1200)).toEqual({ netCents: 3_571_429, vatCents: 428_571 });
    expect(vatFromGross(-5_600_000, 1200)).toEqual({ netCents: -5_000_000, vatCents: -600_000 });
  });

  it('matches the integer formula for 12%', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e11, max: 1e11 }), (g) => {
        const expected = Math.sign(g) * Math.floor((Math.abs(g) * 12 + 56) / 112);
        expect(vatFromGross(g, 1200).vatCents).toBe(expected + 0);
      }),
    );
  });

  it('applies withholding rates (PLAN G-13)', () => {
    expect(applyRate(3_571_429, 500)).toBe(178_571);
    expect(applyRate(2_500_000, 100)).toBe(25_000);
  });

  it('allocates exactly by largest remainder', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    fc.assert(
      fc.property(
        fc.integer({ min: -1e9, max: 1e9 }),
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 8 }).filter((w) => w.some((x) => x > 0)),
        (t, w) => {
          expect(allocate(t, w).reduce((a, b) => a + b, 0)).toBe(t);
        },
      ),
    );
  });

  it('parses and formats pesos', () => {
    expect(parsePesos('₱1,234.5')).toBe(123_450);
    expect(parsePesos('-20')).toBe(-2000);
    expect(() => parsePesos('1.234')).toThrow();
    expect(formatPeso(123_456_789)).toBe('₱1,234,567.89');
    expect(formatPeso(-5)).toBe('-₱0.05');
  });
});

describe('dates', () => {
  it('uses the Manila date, not the UTC date', () => {
    // 2026-09-27 17:30 UTC is already 2026-09-28 01:30 in Manila.
    const at = new Date('2026-09-27T17:30:00Z');
    expect(manilaDate(at)).toBe('2026-09-28');
    expect(manilaTimestamp(at)).toBe('2026-09-28T01:30:00.000+08:00');
  });
});
