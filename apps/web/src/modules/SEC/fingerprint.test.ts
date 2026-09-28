import { describe, expect, it } from 'vitest';
import { groupFingerprint256 } from './fingerprint.ts';

describe('groupFingerprint256', () => {
  it('shows a SHA-256 fingerprint in eight groups of four pairs', () => {
    const fingerprint = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':');
    const grouped = groupFingerprint256(fingerprint);
    expect(grouped.split(' ')).toHaveLength(8);
    expect(grouped).toMatch(/^00:01:02:03 04:05:06:07 /);
    expect(grouped.split(' ').join(':')).toBe(fingerprint);
  });
});
