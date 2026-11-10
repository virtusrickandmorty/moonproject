export interface AuditFilters {
  from: string; to: string; userId: string; action: string; entityType: string; entityId: string;
  /** A document's number (JO-000036): everything done to it. */
  number: string;
}

/** Keep paging and CSV on the same set of filters. */
export function auditQuery(filters: AuditFilters, before?: number, format?: 'csv'): string {
  const q = new URLSearchParams();
  for (const key of ['from', 'to', 'userId', 'action', 'entityType', 'entityId', 'number'] as const) {
    const value = filters[key].trim();
    if (value) q.set(key, value);
  }
  q.set('limit', '50');
  if (before !== undefined) q.set('before', String(before));
  if (format) q.set('format', format);
  return q.toString();
}

export function auditData(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2);
}
