import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { searchCustomers, searchWearers } from '../CUS/public.ts';
import { searchJobOrders, searchInvoiceNumbers } from '../JO/public.ts';
import { searchCrNumbers } from '../COL/public.ts';
import { searchSuppliers } from '../PUR/public.ts';
import { searchEmployees } from '../EMP/public.ts';

export type SearchKind = 'customer' | 'wearer' | 'job_order' | 'document' | 'supplier' | 'employee';
export interface SearchResult { kind: SearchKind; label: string; detail?: string; href: string }

const compact = (s: string) => s.toLowerCase().replace(/[\s-]/g, '');
const numberKey = (s: string) => compact(s).replace(/(\D)0+(\d)/g, '$1$2');
const matchesNumber = (value: string, query: string) => numberKey(value).includes(numberKey(query));

export function navRoutes(app: FastifyInstance, { db, registry }: AppDeps): void {
  app.get('/api/nav/search', { config: { permission: 'nav.search' } }, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(100) }).strict().parse(req.query);
    const permissions = currentUser(req).permissions;
    const out: SearchResult[] = [];
    if (permissions.has('cus.view')) {
      out.push(...searchCustomers(db, q).map((x) => ({ kind: 'customer' as const, label: x.name, href: `/cus?customer=${x.id}` })));
      out.push(...searchWearers(db, q).map((x) => ({ kind: 'wearer' as const, label: x.name, detail: 'Wearer', href: `/cus?customer=${x.customerId}&person=${x.id}` })));
    }
    if (permissions.has('jo.view')) {
      out.push(...searchJobOrders(db).filter((x) => matchesNumber(x.number, q) || compact(x.customerName).includes(compact(q))).slice(0, 20)
        .map((x) => ({ kind: 'job_order' as const, label: x.number, detail: x.customerName, href: `/docs/jo.job_order/${x.id}` })));
      out.push(...searchInvoiceNumbers(db).filter((x) => matchesNumber(x.externalNumber, q)).slice(0, 20)
        .map((x) => ({ kind: 'document' as const, label: `Invoice record ${x.externalNumber}`, detail: x.number, href: `/docs/jo.invoice/${x.id}` })));
    }
    if (permissions.has('col.view')) out.push(...searchCrNumbers(db).filter((x) => matchesNumber(x.externalNumber, q)).slice(0, 20)
      .map((x) => ({ kind: 'document' as const, label: `CR ${x.externalNumber}`, detail: x.number, href: `/docs/col.collection/${x.id}` })));
    const documents = db.prepare('SELECT id, doc_type AS docType, number FROM documents ORDER BY business_date DESC, number DESC').all() as { id: string; docType: string; number: string }[];
    out.push(...documents.filter((x) => {
      const view = registry.docType(x.docType)?.permissions.view;
      return !!view && permissions.has(view) && matchesNumber(x.number, q);
    }).slice(0, 20).map((x) => ({ kind: 'document' as const, label: x.number, href: `/docs/${x.docType}/${x.id}` })));
    if (permissions.has('pur.supplier.view')) out.push(...searchSuppliers(db, q).map((x) => ({ kind: 'supplier' as const, label: x.name, href: `/pur/suppliers/${x.id}` })));
    if (permissions.has('emp.view')) out.push(...searchEmployees(db, q).map((x) => ({ kind: 'employee' as const, label: x.name, detail: x.code, href: `/emp/employees/${x.id}` })));
    const counts = new Map<SearchKind, number>();
    const seen = new Set<string>();
    return out.filter((result) => {
      if (seen.has(result.href)) return false;
      const count = counts.get(result.kind) ?? 0;
      if (count >= 20) return false;
      seen.add(result.href);
      counts.set(result.kind, count + 1);
      return true;
    });
  });
}
