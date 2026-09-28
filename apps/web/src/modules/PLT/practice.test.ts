import { describe, expect, it } from 'vitest';
import { practiceAddress, practiceLine } from './practice.ts';

describe('practice shop words', () => {
  it('points at the same PC on the practice port', () => {
    expect(practiceAddress({ protocol: 'https:', hostname: 'moonproject.local' }, 8443)).toBe('https://moonproject.local:8443/');
    expect(practiceAddress({ protocol: 'http:', hostname: '127.0.0.1' }, 3001)).toBe('http://127.0.0.1:3001/');
  });

  it('says where the practice shop stands', () => {
    const base = { port: 8443, preparedAt: null, days: 30, message: null };
    expect(practiceLine({ ...base, state: 'ready' })).toBe('The practice shop is ready, with 30 days of made-up shop work.');
    expect(practiceLine({ ...base, state: 'off' })).toBe('Practice mode is off on this PC. The Windows installer turns it on.');
    expect(practiceLine({ ...base, state: 'failed', message: 'Port 8443 is taken.' })).toBe('The practice shop is not running. Port 8443 is taken.');
    expect(practiceLine({ ...base, state: 'preparing' })).toContain('being prepared');
  });
});
