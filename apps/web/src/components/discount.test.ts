/** An item's discount, typed as pesos off each piece or a percent of the item (the owner's request, Oct 2026). */
import { expect, it } from 'vitest';
import { discountCentsOf, discountOf } from './discount.tsx';
import { joInput, emptyJo, emptyJoLine } from '../modules/JO/forms.ts';

it('works out the item discount: pesos each times the pieces, or a percent of the item, to the centavo', () => {
  expect(discountCentsOf('each', '20', 30, 50_000)).toBe(60_000); // ₱20 off each of 30
  expect(discountCentsOf('percent', '10', 30, 50_000)).toBe(150_000); // 10% of ₱15,000
  expect(discountCentsOf('percent', '12.5%', 3, 33_333)).toBe(12_500); // 12.5% of ₱999.99, rounded
  expect(discountCentsOf('each', '', 30, 50_000)).toBe(0);
  expect(discountCentsOf('percent', '101', 1, 100)).toBeUndefined();
  expect(discountCentsOf('each', 'abc', 1, 100)).toBeUndefined();
});

it('shows a saved discount as pesos each when it divides by the pieces, else as a percent', () => {
  expect(discountOf(60_000, 30, 50_000)).toEqual({ mode: 'each', text: '20.00' });
  expect(discountOf(10_000, 3, 33_333)).toEqual({ mode: 'percent', text: '10' }); // 10% of ₱999.99: ₱100.00, not a peso amount each
  expect(discountOf(100_000, 3, 100_000)).toEqual({ mode: 'each', text: '333.33' }); // an old lump sum: the nearest each
  expect(discountOf(0, 3, 100_000)).toEqual({ mode: 'each', text: '' });
});

it('a job order item sends its discount in centavos, each or percent', () => {
  const line = { ...emptyJoLine(), description: 'Jerseys', qty: '30', price: '500.00' };
  const each = joInput({ ...emptyJo(), customer: { id: 'c1', name: 'A school' }, paymentTerms: 'full', lines: [{ ...line, discount: '20' }] });
  expect(each.input?.lines[0]?.discountCents).toBe(60_000);
  const pct = joInput({ ...emptyJo(), customer: { id: 'c1', name: 'A school' }, paymentTerms: 'full', lines: [{ ...line, discount: '10', discountMode: 'percent' }] });
  expect(pct.input?.lines[0]?.discountCents).toBe(150_000);
  expect(pct.totalCents).toBe(1_350_000);
  const bad = joInput({ ...emptyJo(), customer: { id: 'c1', name: 'A school' }, paymentTerms: 'full', lines: [{ ...line, discount: '150', discountMode: 'percent' }] });
  expect(bad.errors.join(' ')).toContain('type a percent from 0 to 100');
});
