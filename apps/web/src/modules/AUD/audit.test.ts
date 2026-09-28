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
