import { describe, expect, it } from 'vitest';
import { saysSet, sizeLabel } from './sizes.ts';

describe('sizes and sets (the owner\'s requests, Oct 2026)', () => {
  it('reads "set" in a description as a word on its own, any case', () => {
    for (const d of ['Sublimated Female Tshirt Jersey: Cafamilia; Polydex Fabric 200gsm SET', 'Team jersey set', 'Scrubsuit (set)', 'Uniform sets', 'SET of 2']) expect(saysSet(d), d).toBe(true);
    for (const d of ['Jersey UPPER ONLY', 'Reset collar', 'Setter jersey', 'Sunset print', 'Polo shirt']) expect(saysSet(d), d).toBe(false);
  });
  it('shows a set\'s upper and lower size', () => {
    expect(sizeLabel('M', 'L')).toBe('Upper M · Lower L');
    expect(sizeLabel('M')).toBe('M');
  });
});
