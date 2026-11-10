/**
 * Job orders from an order link (the owner's request, Nov 2026). Staff pick answers and start a job order from them:
 * - together: one job order for the team, or for the whole group (or the answers ticked), for one customer;
 * - alone: one member's own job order (a member who pays for their own, or filled in late), for that member.
 * This finds or makes the customer from the answer's details, makes a wearer for each person (with a measurement chart
 * when they gave measurements), so the answer can show the job orders made from it (its order status), and returns the job order's lines (price list prices, wearers,
 * sizes, jersey names and numbers) for the job order form, where staff check them and record it. An item's own length or
 * width goes in that row's notes. A second start reuses the customer's wearers and charts the link made, with a new
 * chart revision only when the answer was changed since.
 */
import { z } from 'zod';
import { badRequest, conflict, forbidden, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { catalogItemRef, lookupCatalogPrice } from '../CAT/public.ts';
import { addCustomerPhone, createCustomer, createMeasurement, createWearer, customerRef } from '../CUS/public.ts';
import { MEASURES, answerOf, itemsOf, linkRow, type Who } from './links.ts';

export const prepareInput = z.object({
  responseIds: z.array(z.uuid()).min(1).max(1000),
  together: z.boolean(),
  customerId: z.uuid().optional(),
}).strict();

type Answer = ReturnType<typeof answerOf>;
/** A job order roster row, as the job order form takes it. */
interface RosterRow { personId?: string; name: string; sizeMode: 'preset' | 'measured'; size?: string; lowerSize?: string; jerseyName?: string; jerseyNumber?: string; qty: number; notes?: string }
type Person = Answer['people'][number];
const KIND = { made_to_order_garment: 'made_to_order', service: 'service', ready_made_item: 'ready_made' } as const;
const label = (f: string) => MEASURES.find((m) => m[0] === f)?.[1].toLowerCase() ?? f;
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The customer an answer's own details make: the active customer with that email, or a new one. */
function customerOf(db: Db, a: Answer, who: Who): string {
  const same = db.prepare('SELECT id FROM cus_customers WHERE is_active = 1 AND lower(email) = ? ORDER BY created_at LIMIT 1').pluck().get(a.email.toLowerCase()) as string | undefined;
  if (same) return same;
  const { id } = createCustomer(db, { kind: 'person', displayName: a.name, billingAddress: a.address, email: a.email, notes: 'Made from an order link.' }, who);
  addCustomerPhone(db, id, { phone: a.mobile, label: 'Mobile' }, who);
  return id;
}

/** The wearer for one person of an answer under this customer, with a chart from the answer's measurements. */
function wearerOf(db: Db, a: Answer, version: number, p: Person, kind: 'team' | 'group', customerId: string, who: Who): string {
  const made = db.prepare('SELECT person_id, chart_version FROM olk_wearers WHERE response_id = ? AND row_no = ? AND customer_id = ?').get(a.id, p.row, customerId) as
    { person_id: string; chart_version: number | null } | undefined;
  const personId = made?.person_id ?? createWearer(db, customerId, {
    fullName: kind === 'team' ? p.name ?? p.backName ?? `Player ${p.row}` : a.name, gender: p.gender === 'female' ? 'Female' : 'Male',
    ...(p.backName ? { defaultJerseyName: p.backName } : {}), ...(p.number ? { defaultJerseyNumber: p.number } : {}),
  }, who).id;
  if (!made) db.prepare('INSERT INTO olk_wearers (response_id, row_no, customer_id, person_id) VALUES (?, ?, ?, ?)').run(a.id, p.row, customerId, personId);
  const hasMeasures = !p.measureAtShop && Object.keys(p.measures).length > 0;
  if (hasMeasures && made?.chart_version !== version) {
    const prior = db.prepare('SELECT COUNT(*) FROM cus_measure_charts WHERE person_id = ?').pluck().get(personId) as number;
    createMeasurement(db, personId, { sizeMode: 'measured', unit: 'inch', values: p.measures, remarks: 'From an order link.',
      ...(prior ? { reason: 'Measurements from the order link' } : {}) }, who);
    db.prepare('UPDATE olk_wearers SET chart_version = ? WHERE response_id = ? AND row_no = ? AND customer_id = ?').run(version, a.id, p.row, customerId);
  }
  return personId;
}

/** Starts a job order from answers of a link: the customer and the lines, for the job order form. */
export function prepareJobOrder(db: Db, linkId: string, raw: unknown, who: Who & { permissions: Set<string> }) {
  const v = prepareInput.parse(raw);
  const l = linkRow(db, linkId);
  if (!l) throw notFound('That order link');
  for (const perm of ['cus.manage', 'cus.measure']) if (!who.permissions.has(perm)) throw forbidden(perm);
  const ids = [...new Set(v.responseIds)];
  const belongs = db.prepare('SELECT version FROM olk_responses WHERE id = ? AND link_id = ?').pluck();
  const answers = ids.map((id) => {
    const version = belongs.get(id, l.id) as number | undefined;
    if (version === undefined) throw badRequest('ANSWER', 'Pick answers of this link.');
    return { a: answerOf(db, id), version };
  });
  if (!v.together && answers.length !== 1) throw badRequest('ANSWER', "A member's own job order is for one answer.");
  // Together: the customer picked, else the link's, else (one answer) the one who filled it in. Alone: that member.
  const customerId = v.customerId ?? (v.together ? l.customer_id ?? (answers.length === 1 ? null : undefined) : null);
  if (customerId === undefined) throw badRequest('CUSTOMER', "Pick the customer for the group's job order.");
  if (customerId && !customerRef(db, customerId)?.is_active) throw badRequest('CUSTOMER', 'Pick an active customer.');
  const customer = customerId ?? customerOf(db, answers[0]!.a, who);
  const ref = customerRef(db, customer);
  if (!ref?.is_active) throw conflict('CUSTOMER', 'That customer is no longer active. Pick another.');

  const items = itemsOf(db, l.id);
  const lines = items.flatMap((it) => {
    const item = catalogItemRef(db, it.itemId);
    const roster = answers.flatMap(({ a, version }) => a.people.flatMap((p): RosterRow[] => {
      const pc = p.pieces.find((x) => x.lineNo === it.lineNo);
      if (!pc) return [];
      const name = l.kind === 'team' ? p.name ?? p.backName ?? `Player ${p.row}` : a.name;
      const jersey = { ...(p.backName ? { jerseyName: p.backName } : {}), ...(p.number ? { jerseyNumber: p.number } : {}) };
      if (it.sizing === 'size' && !pc.customFit) {
        return [{ personId: wearerOf(db, a, version, p, l.kind, customer, who), name, sizeMode: 'preset', size: pc.size!, ...(item?.unit === 'set' ? { lowerSize: pc.size! } : {}), ...jersey, qty: pc.qty }];
      }
      const own = p.itemMeasures.filter((m) => m.lineNo === it.lineNo).map((m) => `${label(m.field)} ${m.value} in`);
      const notes = [pc.customFit ? 'Custom fit' : '', p.measureAtShop ? 'Measure at the shop' : own.length ? `For this item: ${own.join(', ')}` : ''].filter(Boolean).join('. ');
      return [{ personId: wearerOf(db, a, version, p, l.kind, customer, who), name, sizeMode: 'measured', ...jersey, qty: pc.qty, ...(notes ? { notes: cut(notes, 200) } : {}) }];
    }));
    if (!roster.length) return [];
    const qty = roster.reduce((s, r) => s + r.qty, 0);
    const price = item?.isActive ? lookupCatalogPrice(db, it.itemId, qty, who.today) : null;
    return [{ itemId: it.itemId, kind: item ? KIND[item.class] : 'made_to_order', description: it.name, isSet: item?.unit === 'set', qty, listCents: price?.unitPriceCents ?? null, roster }];
  });
  if (!lines.length) throw badRequest('PIECES', 'Those answers have no pieces.');

  const made = db.prepare('INSERT INTO olk_made (id, response_id, made_at, version, customer_id, together, made_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const { a, version } of answers) made.run(newId(), a.id, who.at, version, customer, +v.together, who.userId);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'olk.job_order.start', entityType: 'olk.link', entityId: l.id, data: { answers: answers.length, together: v.together, customerId: customer } });
  const one = answers.length === 1 ? answers[0]!.a : null;
  return {
    customer: { id: customer, name: ref.display_name },
    contact: one ? cut(`${one.name} · ${one.mobile}`, 200) : '',
    notes: cut(`From the order link "${l.title}"${one ? '' : ` (${answers.length} answers)`}.`, 1000),
    lines,
  };
}
