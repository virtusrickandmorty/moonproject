/**
 * The search bar (the owner's request, 26 Oct 2026: one search for all the data). Each kind of record is searched only
 * for users who may view it: customers and wearers, job orders, every recorded document (by its number, the number on
 * its paper form, or the words of its summary: a customer's or supplier's name, what it was for), suppliers, supplies,
 * price list items, the website shop's products and online orders, employees, owners and officers, and cash accounts.
 * The screens and New forms are matched in the browser, from the menu the user has (NAV/Search.tsx).
 */
import type { Db } from '../../platform/db/driver.ts';
import type { Registry } from '../../engine/documents/registry.ts';
import type { SessionUser } from '../../engine/security/sessions.ts';
import { listCashPlaces } from '../../engine/ledger/accounts.ts';
import { searchCatalogItems } from '../CAT/public.ts';
import { searchCustomers, searchWearers } from '../CUS/public.ts';
import { searchEmployees } from '../EMP/public.ts';
import { searchPeople } from '../EQ/public.ts';
import { searchJobOrders } from '../JO/public.ts';
import { searchSuppliers, searchSupplies } from '../PUR/public.ts';
import { searchOnlineOrders, searchShopProducts } from '../SHP/public.ts';

export type SearchKind = 'Customer' | 'Wearer' | 'Job order' | 'Document' | 'Supplier' | 'Employee'
  | 'Supply' | 'Price list item' | 'Shop product' | 'Online order' | 'Owner or officer' | 'Cash account';
export interface NavResult { kind: SearchKind; id: string; label: string; detail?: string; href: string }

const compact = (s: string) => s.toLocaleLowerCase().replace(/[\s-]/g, '');
const DOCS = 20;

export function search(db: Db, registry: Registry, user: SessionUser, raw: string): NavResult[] {
  const q = raw.trim();
  const numberQuery = compact(q);
  const can = (p: string) => user.permissions.has(p);
  const out: NavResult[] = [];
  if (can('cus.view')) {
    out.push(...searchCustomers(db, q).map((x) => ({ kind: 'Customer' as const, id: x.id, label: x.name, href: `/cus?customer=${encodeURIComponent(x.id)}` })));
  }
  if (can('cus.measure.view')) {
    out.push(...searchWearers(db, q).map((x) => ({ kind: 'Wearer' as const, id: x.id, label: x.name, href: `/cus?customer=${encodeURIComponent(x.customerId)}&wearer=${encodeURIComponent(x.id)}` })));
  }
  if (can('jo.view')) {
    out.push(...searchJobOrders(db, numberQuery).map((x) => ({ kind: 'Job order' as const, id: x.id, label: x.number, detail: x.customerName, href: `/docs/jo.job_order/${x.id}` })));
  }
  // Documents the user may view: by number first, then by the words of their summary, newest first.
  const types = new Map(registry.docTypes().filter((d) => can(d.permissions.view)).map((d) => [d.key, d.title]));
  if (types.size > 0) {
    const docs = db.prepare(`SELECT id, doc_type AS docType, number, external_number AS externalNumber, summary, business_date AS date,
        (replace(replace(lower(number), '-', ''), ' ', '') LIKE @n OR replace(replace(lower(COALESCE(external_number, '')), '-', ''), ' ', '') LIKE @n) AS byNumber
      FROM documents WHERE doc_type IN (SELECT value FROM json_each(@types)) AND (
        replace(replace(lower(number), '-', ''), ' ', '') LIKE @n OR replace(replace(lower(COALESCE(external_number, '')), '-', ''), ' ', '') LIKE @n
        OR (length(@q) >= 3 AND summary LIKE '%' || @q || '%' COLLATE NOCASE))
      ORDER BY byNumber DESC, business_date DESC, number DESC LIMIT ${DOCS}`).all({ n: `%${numberQuery}%`, q, types: JSON.stringify([...types.keys()]) }) as
      { id: string; docType: string; number: string; externalNumber: string | null; summary: string; date: string; byNumber: number }[];
    const seen = new Set(out.map((r) => r.id));
    out.push(...docs.filter((d) => !seen.has(d.id)).map((d) => ({
      kind: 'Document' as const, id: d.id, href: `/docs/${d.docType}/${d.id}`,
      label: `${d.number}${d.externalNumber ? ` · ${d.externalNumber}` : ''} · ${types.get(d.docType) ?? d.docType}`,
      detail: d.byNumber ? d.date : d.summary.replace(/^This will (record |issue )?/i, '').slice(0, 90),
    })));
  }
  if (can('pur.supplier.view')) out.push(...searchSuppliers(db, q).map((x) => ({ kind: 'Supplier' as const, id: x.id, label: x.name, href: `/pur/suppliers/${x.id}` })));
  if (can('pur.supply.view')) out.push(...searchSupplies(db, q).map((x) => ({ kind: 'Supply' as const, id: x.id, label: x.name, detail: `by the ${x.unit}`, href: `/pur/supplies/${x.id}` })));
  if (can('cat.view')) out.push(...searchCatalogItems(db, q).map((x) => ({ kind: 'Price list item' as const, id: x.id, label: x.name, detail: x.code, href: `/cat?item=${encodeURIComponent(x.id)}` })));
  if (can('shp.view')) out.push(...searchShopProducts(db, q).map((x) => ({ kind: 'Shop product' as const, id: x.id, label: x.name, href: `/shp?product=${encodeURIComponent(x.id)}` })));
  if (can('shp.orders.view')) out.push(...searchOnlineOrders(db, q).map((x) => ({ kind: 'Online order' as const, id: x.id, label: x.number, detail: `${x.name} · ${x.status.replace('_', ' ')}`, href: `/shp/orders?open=${encodeURIComponent(x.id)}` })));
  if (can('emp.view')) out.push(...searchEmployees(db, q).map((x) => ({ kind: 'Employee' as const, id: x.id, label: x.name, detail: x.code, href: `/emp/employees/${x.id}` })));
  if (can('eq.people.view')) out.push(...searchPeople(db, q).map((x) => ({ kind: 'Owner or officer' as const, id: x.id, label: x.name, ...(x.position ? { detail: x.position } : {}), href: `/eq/people/${x.id}` })));
  if (can('cash.places.view')) {
    const words = q.toLocaleLowerCase();
    out.push(...listCashPlaces(db).filter((p) => p.name.toLocaleLowerCase().includes(words) || p.code.includes(words)).slice(0, 10)
      .map((p) => ({ kind: 'Cash account' as const, id: String(p.id), label: p.name, detail: `Account ${p.code}`, href: can('cash.book.view') ? `/cash/book?place=${p.id}` : '/cash/accounts' })));
  }
  return out;
}
