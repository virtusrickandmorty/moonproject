import { expect, it } from 'vitest';
import { centsOf, priceFor } from './OrderLinkPage.tsx';

it("prices a member's pieces at the tier their quantity reaches, and reads the amount they paid", () => {
  const tiers = [{ fromQty: 1, unitPriceCents: 60_000 }, { fromQty: 3, unitPriceCents: 55_000 }];
  expect([0, 1, 2, 3, 10].map((q) => priceFor(tiers, q))).toEqual([60_000, 60_000, 60_000, 55_000, 55_000]);
  expect(priceFor([], 2)).toBeNull();
  expect(['1500', '1,500.50', '₱ 1,500.5', '2150.00'].map(centsOf)).toEqual([150_000, 150_050, 150_050, 215_000]);
  expect(['', 'abc', '1.234', '-5'].map(centsOf)).toEqual([null, null, null, null]);
});
