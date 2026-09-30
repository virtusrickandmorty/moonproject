import type { Db } from '../../platform/db/driver.ts';
import type { Registry } from '../../engine/documents/registry.ts';
import type { SessionUser } from '../../engine/security/sessions.ts';
import { searchCustomers, searchWearers } from '../CUS/public.ts';
import { searchEmployees } from '../EMP/public.ts';
import { searchJobOrders } from '../JO/public.ts';
import { searchSuppliers } from '../PUR/public.ts';

export type SearchKind = 'Customer' | 'Wearer' | 'Job order' | 'Document' | 'Supplier' | 'Employee';
export interface NavResult { kind: SearchKind; id: string; label: string; detail?: string; href: string }

const compact = (s: string) => s.toLocaleLowerCase().replace(/[\s-]/g, '');

export function search(db: Db, registry: Registry, user: SessionUser, raw: string): NavResult[] {
  const q = raw.trim();
  const numberQuery = compact(q);
  const out: NavResult[] = [];
  if (user.permissions.has('cus.view')) {
    out.push(...searchCustomers(db, q).map((x) => ({ kind: 'Customer' as const, id: x.id, label: x.name, href: `/cus?customer=${encodeURIComponent(x.id)}` })));
  }
  if (user.permissions.has('cus.measure.view')) {
    out.push(...searchWearers(db, q).map((x) => ({ kind: 'Wearer' as const, id: x.id, label: x.name, href: `/cus?customer=${encodeURIComponent(x.customerId)}&wearer=${encodeURIComponent(x.id)}` })));
  }
  if (user.permissions.has('jo.view')) {
    out.push(...searchJobOrders(db, numberQuery).map((x) => ({ kind: 'Job order' as const, id: x.id, label: x.number, detail: x.customerName, href: `/docs/jo.job_order/${x.id}` })));
  }
  const visibleTypes = new Set(registry.docTypes().filter((d) => user.permissions.has(d.permissions.view)).map((d) => d.key));
  const docs = db.prepare(`SELECT id, doc_type AS docType, number, external_number AS externalNumber FROM documents
    WHERE (replace(replace(lower(number), '-', ''), ' ', '') LIKE @q OR replace(replace(lower(COALESCE(external_number, '')), '-', ''), ' ', '') LIKE @q)
    ORDER BY business_date DESC, number DESC LIMIT 100`).all({ q: `%${numberQuery}%` }) as { id: string; docType: string; number: string; externalNumber: string | null }[];
  out.push(...docs.filter((d) => visibleTypes.has(d.docType)).slice(0, 20).map((d) => ({
    kind: 'Document' as const, id: d.id, label: d.externalNumber ? `${d.number} · ${d.externalNumber}` : d.number, href: `/docs/${d.docType}/${d.id}`,
  })));
  if (user.permissions.has('pur.supplier.view')) out.push(...searchSuppliers(db, q).map((x) => ({ kind: 'Supplier' as const, id: x.id, label: x.name, href: `/pur/suppliers/${x.id}` })));
  if (user.permissions.has('emp.view')) out.push(...searchEmployees(db, q).map((x) => ({ kind: 'Employee' as const, id: x.id, label: x.name, detail: x.code, href: `/emp/employees/${x.id}` })));
  return out;
}
