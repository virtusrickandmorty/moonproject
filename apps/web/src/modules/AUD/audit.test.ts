import { describe, expect, it } from 'vitest';
import { auditData, auditQuery, type AuditFilters } from './audit.ts';

const empty: AuditFilters = { from: '', to: '', userId: '', action: '', entityType: '', entityId: '' };

describe('audit screen helpers', () => {
  it('uses identical filters for paging and CSV', () => {
    const filters = { ...empty, from: '2026-09-01', to: '2026-09-28', userId: ' u1 ', action: 'cus.update', entityType: 'customer', entityId: 'c1' };
    const page = new URLSearchParams(auditQuery(filters, 42));
    const csv = new URLSearchParams(auditQuery(filters, 42, 'csv'));
    expect(page.get('before')).toBe('42');
    expect(page.get('userId')).toBe('u1');
    expect(Object.fromEntries(csv)).toEqual({ ...Object.fromEntries(page), format: 'csv' });
    expect(new URLSearchParams(auditQuery(empty)).has('before')).toBe(false);
  });

  it('shows the recorded data, including before and after values', () => {
    expect(auditData({ before: { name: 'Old' }, after: { name: 'New' } })).toContain('"New"');
  });
});

describe('nightly checks screen helpers', () => {
  it('words the Home line only when last night found something', async () => {
    const { nightlyLine, checkResult } = await import('./nightly.ts');
    expect(nightlyLine({ night: null, ranAt: null, integrity: null, foundCount: 0, found: [] })).toBeNull();
    expect(nightlyLine({ night: '2026-09-27', ranAt: null, integrity: null, foundCount: 0, found: [] })).toBeNull();
    expect(nightlyLine({ night: '2026-09-27', ranAt: null, integrity: null, foundCount: 3, found: [{ key: 'gaps', label: 'Gaps in number series', foundCount: 1 }, { key: 'late', label: 'Late entries', foundCount: 2 }] }))
      .toBe("Last night's checks (2026-09-27) found 3 things to look at: gaps in number series, late entries.");
    expect([checkResult({ passed: true, foundCount: 0 }), checkResult({ passed: false, foundCount: 4 })]).toEqual(['Passed', '4 found']);
  });
});
