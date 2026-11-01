import { expect, it } from 'vitest';
import { inchesOf } from './OrderLinkPage.tsx';

it('reads a measurement the way people type it, in inches to two decimals', () => {
  expect(['32', '32.5', '32 1/2', '32½', '32"', '32 in', '30 3/4'].map(inchesOf)).toEqual([32, 32.5, 32.5, 32.5, 32, 32, 30.75]);
  expect(inchesOf('15 1/8')).toBe(15.13);
  expect(['', 'abc', '0', '32cm', '1000'].map(inchesOf)).toEqual([null, null, null, null, null]);
});
