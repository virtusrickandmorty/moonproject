import { expect, it } from 'vitest';
import { isOffline, newClientKey } from './offline.ts';

it("makes a fresh key on the phone for each new answer, the shape the server takes, and knows a failure with no internet", () => {
  const keys = new Set(Array.from({ length: 50 }, newClientKey));
  expect(keys.size).toBe(50);
  for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9_-]{24,64}$/);
  expect(isOffline(Object.assign(new Error('x'), { offline: true }))).toBe(true);
  expect(isOffline(Object.assign(new Error('x'), { status: 400 }))).toBe(false);
});
