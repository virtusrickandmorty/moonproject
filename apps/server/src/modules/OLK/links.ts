/**
 * Order links (the owner's request, Nov 2026): staff make a private link for a customer before any job order exists, and
 * the customer fills in the order there.
 * - Team list: one person (the coach) gives their details and every player: name on the back, number, gender, and for
 *   each item a size, or measurements for a made-to-measure item.
 * - Group order: each member opens the same link and gives their own details, gender, and their pieces: how many of
 *   each item, the size, or measurements.
 * Every answer gives a name, gender, mobile, email and address. Measurements are the person's own (the same set the
 * customer records keep), asked for by the items that are made to measure; an item that needs a different length or
 * width keeps its own value beside them. An answer can be changed with its own key until the link closes; each change is
 * a new version (nothing is deleted). Staff review the answers here; making the job orders is a later step.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError, badRequest, conflict, isBusinessDate, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { catalogItemRef } from '../CAT/public.ts';
import { customerRef, normalizePhone } from '../CUS/public.ts';

/** The measurements a person's chart keeps (CUS), each with its words and how to take it: the measuring guide. */
export const MEASURES = [
  ['shoulder', 'Shoulder', 'Across the back, from one shoulder tip to the other.'],
  ['chest', 'Chest', 'Around the fullest part of the chest, under the arms, tape level.'],
  ['upperWaist', 'Upper waist', 'Around the natural waist, the narrowest part above the navel.'],
  ['collar', 'Collar', 'Around the base of the neck, one finger loose.'],
  ['bustPoint', 'Bust point', 'From the shoulder, at the neck side, down to the fullest point of the bust.'],
  ['figurePoint', 'Figure point', 'From the shoulder, at the neck side, down to the bust line and across.'],
  ['bustDistance', 'Bust distance', 'Straight across, from one bust point to the other.'],
  ['armHole', 'Arm hole', 'Around the arm, up through the armpit and over the shoulder tip.'],
  ['sleeveHole', 'Sleeve opening', 'Around the arm where the sleeve should end.'],
  ['sleeveLength', 'Sleeve length', 'From the shoulder tip down to where the sleeve should end.'],
  ['upperLength', 'Top length', 'From the highest point of the shoulder down to where the top should end.'],
  ['lowerWaist', 'Waist (pants)', 'Around where the pants or skirt will sit.'],
  ['hips', 'Hips', 'Around the fullest part of the hips, feet together.'],
  ['crotch', 'Crotch', 'From the front waist, between the legs, to the back waist.'],
  ['thigh', 'Thigh', 'Around the fullest part of one thigh.'],
  ['calf', 'Calf', 'Around the fullest part of the calf.'],
  ['ankle', 'Ankle', 'Around the leg opening, at the ankle.'],
  ['lowerLength', 'Pants length', 'From the waist down to where the pants or skirt should end.'],
] as const;
export type Measure = (typeof MEASURES)[number][0];
const MEASURE_KEYS = MEASURES.map((m) => m[0]) as [Measure, ...Measure[]];
/** The usual measurements of a top and of pants: staff start from these and may add or drop some. */
export const MEASURE_PRESETS: Record<'top' | 'bottom', Measure[]> = {
  top: ['shoulder', 'chest', 'upperWaist', 'armHole', 'sleeveLength', 'upperLength'],
  bottom: ['lowerWaist', 'hips', 'crotch', 'thigh', 'lowerLength'],
};

const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

// ---- Staff: the links -------------------------------------------------------------------------------------------------
export const linkInput = z.object({
  kind: z.enum(['team', 'group']),
  title: text(3, 120),
  customerId: z.uuid().optional(),
  closesOn: z.string().refine(isBusinessDate, 'Type the date as YYYY-MM-DD.'),
  payOwn: z.boolean().default(false),
  items: z.array(z.object({
    itemId: z.uuid(),
    sizing: z.enum(['size', 'measure']),
    fields: z.array(z.enum(MEASURE_KEYS)).max(18).default([]),
  }).strict()).min(1).max(20),
}).strict();

export interface Who { userId: string; at: string; today: string }

export function createLink(db: Db, raw: unknown, who: Who) {
  const v = linkInput.parse(raw);
  if (v.closesOn < who.today) throw badRequest('CLOSES', 'The link closes today or later.');
  if (v.customerId && !customerRef(db, v.customerId)) throw badRequest('CUSTOMER', 'Pick an active customer, or leave it empty.');
  if (v.payOwn && v.kind !== 'group') throw badRequest('PAY_OWN', 'Only a group order lets each member pay their own share.');
  const items = v.items.map((it, i) => {
    const item = catalogItemRef(db, it.itemId);
    if (!item?.isActive) throw badRequest('ITEM', `Item ${i + 1}: pick an active price list item.`);
    if (it.sizing === 'measure' && it.fields.length === 0) throw badRequest('FIELDS', `${item.name}: pick the measurements it needs.`);
    return { ...it, lineNo: i + 1, name: item.name, fields: it.sizing === 'measure' ? [...new Set(it.fields)] : [] };
  });
  const id = newId();
  const token = randomBytes(18).toString('base64url');
  db.prepare(`INSERT INTO olk_links (id, token, kind, title, customer_id, closes_on, pay_own, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, token, v.kind, v.title, v.customerId ?? null, v.closesOn, +v.payOwn, who.at, who.userId, who.at);
  const line = db.prepare('INSERT INTO olk_link_items (link_id, line_no, item_id, item_name, sizing) VALUES (?, ?, ?, ?, ?)');
  const field = db.prepare('INSERT INTO olk_item_fields (link_id, line_no, field) VALUES (?, ?, ?)');
  for (const it of items) {
    line.run(id, it.lineNo, it.itemId, it.name, it.sizing);
    for (const f of it.fields) field.run(id, it.lineNo, f);
  }
  appendAudit(db, { at: who.at, userId: who.userId, action: 'olk.link.create', entityType: 'olk.link', entityId: id, data: { kind: v.kind, title: v.title, items: items.length } });
  return linkDetail(db, id, who.today);
}

type LinkRow = { id: string; token: string; kind: 'team' | 'group'; title: string; customer_id: string | null; closes_on: string; pay_own: number; closed_at: string | null; created_at: string; version: number };
const linkRow = (db: Db, id: string) => db.prepare('SELECT * FROM olk_links WHERE id = ?').get(id) as LinkRow | undefined;
const isOpen = (l: LinkRow, today: string) => !l.closed_at && l.closes_on >= today;

function itemsOf(db: Db, linkId: string) {
  const items = db.prepare('SELECT line_no AS lineNo, item_id AS itemId, item_name AS name, sizing FROM olk_link_items WHERE link_id = ? ORDER BY line_no').all(linkId) as
    { lineNo: number; itemId: string; name: string; sizing: 'size' | 'measure' }[];
  const fields = db.prepare('SELECT field FROM olk_item_fields WHERE link_id = ? AND line_no = ?').pluck();
  return items.map((it) => ({ ...it, fields: MEASURE_KEYS.filter((k) => (fields.all(linkId, it.lineNo) as string[]).includes(k)) }));
}

/** Staff's list of links, newest first, with how many answered. */
export function listLinks(db: Db, today: string) {
  const rows = db.prepare('SELECT * FROM olk_links ORDER BY created_at DESC').all() as LinkRow[];
  const answers = db.prepare('SELECT COUNT(*) FROM olk_responses WHERE link_id = ?').pluck();
  const people = db.prepare(`SELECT COUNT(*) FROM olk_people p JOIN olk_responses r ON r.id = p.response_id AND p.version = r.version WHERE r.link_id = ?`).pluck();
  return rows.map((l) => ({ id: l.id, kind: l.kind, title: l.title, closesOn: l.closes_on, open: isOpen(l, today), closedEarly: !!l.closed_at,
    answers: answers.get(l.id) as number, people: people.get(l.id) as number, createdAt: l.created_at }));
}

/** One link for staff: its settings, its private part, every answer as it stands, the totals by item and size, and what to check. */
export function linkDetail(db: Db, id: string, today: string) {
  const l = linkRow(db, id);
  if (!l) throw notFound('That order link');
  const items = itemsOf(db, id);
  const responses = (db.prepare('SELECT id FROM olk_responses WHERE link_id = ? ORDER BY created_at').pluck().all(id) as string[]).map((r) => answerOf(db, r));
  const totals = items.map((it) => {
    const bySize = new Map<string, number>();
    for (const r of responses) for (const p of r.people) for (const pc of p.pieces) if (pc.lineNo === it.lineNo) {
      const key = it.sizing === 'size' ? pc.size ?? '?' : p.measureAtShop ? 'Measure at the shop' : 'Measured';
      bySize.set(key, (bySize.get(key) ?? 0) + pc.qty);
    }
    return { lineNo: it.lineNo, name: it.name, sizes: [...bySize].map(([size, qty]) => ({ size, qty })), qty: [...bySize.values()].reduce((a, b) => a + b, 0) };
  });
  return {
    id: l.id, token: l.token, kind: l.kind, title: l.title, closesOn: l.closes_on, open: isOpen(l, today), closedEarly: !!l.closed_at, payOwn: l.pay_own === 1,
    customer: l.customer_id ? { id: l.customer_id, name: customerRef(db, l.customer_id)?.display_name ?? '?' } : null, version: l.version,
    items, responses: responses.map((r) => ({ ...r, checks: checksOf(r, l.kind) })), totals,
    guide: MEASURES.map(([key, label]) => ({ key, label })),
  };
}

/** What staff should look at in an answer: a number used twice, a person to measure at the shop. */
function checksOf(r: ReturnType<typeof answerOf>, kind: 'team' | 'group'): string[] {
  const out: string[] = [];
  if (kind === 'team') {
    const seen = new Map<string, string[]>();
    for (const p of r.people) if (p.number) seen.set(p.number, [...(seen.get(p.number) ?? []), p.backName ?? `row ${p.row}`]);
    for (const [n, who] of seen) if (who.length > 1) out.push(`Number ${n} is used ${who.length} times (${who.join(', ')})`);
  }
  const atShop = r.people.filter((p) => p.measureAtShop).map((p) => (kind === 'team' ? p.backName ?? `row ${p.row}` : r.name));
  if (atShop.length) out.push(`To measure at the shop: ${atShop.join(', ')}`);
  return out;
}

export const closeInput = z.object({ reason: text(3, 200).optional() }).strict();
export function closeLink(db: Db, id: string, who: Who) {
  const l = linkRow(db, id);
  if (!l) throw notFound('That order link');
  if (l.closed_at) return linkDetail(db, id, who.today);
  db.prepare('UPDATE olk_links SET closed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(who.at, who.at, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'olk.link.close', entityType: 'olk.link', entityId: id, data: {} });
  return linkDetail(db, id, who.today);
}

export const reopenInput = z.object({ closesOn: z.string().refine(isBusinessDate, 'Type the date as YYYY-MM-DD.') }).strict();
/** A new closing date (reopens a link closed early too). */
export function setClosingDate(db: Db, id: string, raw: unknown, who: Who) {
  const v = reopenInput.parse(raw);
  if (!linkRow(db, id)) throw notFound('That order link');
  if (v.closesOn < who.today) throw badRequest('CLOSES', 'The link closes today or later.');
  db.prepare('UPDATE olk_links SET closes_on = ?, closed_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?').run(v.closesOn, who.at, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'olk.link.date', entityType: 'olk.link', entityId: id, data: v });
  return linkDetail(db, id, who.today);
}

// ---- The customer's side ----------------------------------------------------------------------------------------------
const linkByToken = (db: Db, token: string) => db.prepare('SELECT * FROM olk_links WHERE token = ?').get(token) as LinkRow | undefined;

/** What the link's page shows: what the order is, the items and how each is sized, the sizes, and the measuring guide. */
export function publicLink(db: Db, token: string, today: string) {
  const l = linkByToken(db, token);
  if (!l) throw notFound('That order link');
  const sizes = db.prepare("SELECT label, category FROM cus_sizes WHERE is_active = 1 ORDER BY category, rowid").all() as { label: string; category: 'adult' | 'kids' }[];
  return {
    kind: l.kind, title: l.title, closesOn: l.closes_on, open: isOpen(l, today), payOwn: l.pay_own === 1,
    items: itemsOf(db, l.id).map(({ lineNo, name, sizing, fields }) => ({ lineNo, name, sizing, fields })),
    sizes, guide: MEASURES.map(([key, label, how]) => ({ key, label, how })),
  };
}

const inches = z.number().positive().max(300).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Use at most two decimals.');
const personInput = z.object({
  row: z.number().int().min(0).max(500),
  name: text(1, 120).optional(),
  backName: text(1, 40).optional(),
  number: z.string().trim().regex(/^\d{1,3}$/, 'A number has up to 3 digits.').optional(),
  gender: z.enum(['female', 'male']),
  measureAtShop: z.boolean().default(false),
  pieces: z.array(z.object({ lineNo: z.number().int().min(1).max(20), qty: z.number().int().min(1).max(100), size: text(1, 30).optional() }).strict()).min(1).max(20),
  measures: z.partialRecord(z.enum(MEASURE_KEYS), inches).default({}),
  itemMeasures: z.array(z.object({ lineNo: z.number().int().min(1).max(20), field: z.enum(MEASURE_KEYS), value: inches }).strict()).max(360).default([]),
}).strict();
export const answerInput = z.object({
  name: text(2, 120),
  gender: z.enum(['female', 'male']),
  mobile: text(7, 20),
  email: text(5, 200),
  address: text(5, 300),
  people: z.array(personInput).min(1).max(500),
}).strict();
type AnswerInput = z.infer<typeof answerInput>;

/** Checks an answer against its link: the right people, items it has, a size from the list, every measurement it needs. */
function checked(db: Db, l: LinkRow, raw: unknown): AnswerInput & { mobile: string } {
  const parsed = answerInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0]!;
    throw badRequest('INVALID_INPUT', `Please check ${first.path.join(' ') || 'the form'}: ${first.message}`);
  }
  const v = parsed.data;
  if (!EMAIL.test(v.email)) throw badRequest('EMAIL', 'Please give a valid email address.');
  let mobile: string;
  try { mobile = normalizePhone(v.mobile); } catch { throw badRequest('MOBILE', 'Please give your mobile number, like 0917 123 4567.'); }
  const items = new Map(itemsOf(db, l.id).map((it) => [it.lineNo, it]));
  const sizes = new Set(db.prepare('SELECT label FROM cus_sizes WHERE is_active = 1').pluck().all() as string[]);
  if (l.kind === 'group' && (v.people.length !== 1 || v.people[0]!.row !== 0)) throw badRequest('PEOPLE', 'A group order answer is for one person: you.');
  if (l.kind === 'team' && v.people.some((p) => p.row === 0)) throw badRequest('PEOPLE', 'Number the players from 1.');
  if (new Set(v.people.map((p) => p.row)).size !== v.people.length) throw badRequest('PEOPLE', 'Each player once.');
  for (const p of v.people) {
    const who = l.kind === 'team' ? `Player ${p.backName ?? p.row}` : 'Your order';
    if (l.kind === 'team' && !p.backName) throw badRequest('BACK_NAME', `Player ${p.row}: type the name on the back.`);
    for (const pc of p.pieces) {
      const it = items.get(pc.lineNo);
      if (!it) throw badRequest('ITEM', `${who}: that item is not on this order.`);
      if (it.sizing === 'size' && (!pc.size || !sizes.has(pc.size))) throw badRequest('SIZE', `${who}: pick a size for ${it.name}.`);
      if (it.sizing === 'measure' && !p.measureAtShop) {
        const own = p.measures as Partial<Record<Measure, number>>;
        const missing = it.fields.filter((f) => own[f] === undefined && !p.itemMeasures.some((m) => m.lineNo === it.lineNo && m.field === f));
        if (missing.length) throw badRequest('MEASURES', `${who}: type ${missing.map((f) => MEASURES.find((m) => m[0] === f)![1].toLowerCase()).join(', ')} for ${it.name}, or tick "measure me at the shop".`);
      }
    }
    if (new Set(p.pieces.map((pc) => pc.lineNo)).size !== p.pieces.length) throw badRequest('ITEM', `${who}: each item once.`);
  }
  return { ...v, mobile };
}

function saveVersion(db: Db, responseId: string, version: number, v: AnswerInput) {
  const person = db.prepare('INSERT INTO olk_people (response_id, version, row_no, name, back_name, number, gender, measure_at_shop) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const piece = db.prepare('INSERT INTO olk_pieces (response_id, version, row_no, line_no, qty, size) VALUES (?, ?, ?, ?, ?, ?)');
  const measure = db.prepare('INSERT INTO olk_measures (response_id, version, row_no, line_no, field, hundredths) VALUES (?, ?, ?, ?, ?, ?)');
  for (const p of v.people) {
    person.run(responseId, version, p.row, p.name ?? null, p.backName?.toUpperCase() ?? null, p.number ?? null, p.gender, +p.measureAtShop);
    for (const pc of p.pieces) piece.run(responseId, version, p.row, pc.lineNo, pc.qty, pc.size ?? null);
    for (const [f, val] of Object.entries(p.measures)) measure.run(responseId, version, p.row, 0, f, Math.round(val * 100));
    // An item's own value only where it differs from the person's (some items vary in length or width).
    for (const m of p.itemMeasures) if ((p.measures as Record<string, number>)[m.field] !== m.value) measure.run(responseId, version, p.row, m.lineNo, m.field, Math.round(m.value * 100));
  }
}

const ANSWERS_PER_SENDER_PER_HOUR = 30;
const ANSWERS_PER_LINK = 1000;

/** A new answer; returns the key that changes it later (only its hash is kept). */
export function submitAnswer(db: Db, token: string, raw: unknown, ctx: { at: string; today: string; ip: string; hourAgo: string }) {
  const l = linkByToken(db, token);
  if (!l) throw notFound('That order link');
  if (!isOpen(l, ctx.today)) throw conflict('LINK_CLOSED', 'This link is closed. Please message the shop.');
  const recent = db.prepare('SELECT COUNT(*) FROM olk_responses WHERE ip = ? AND created_at >= ?').pluck().get(ctx.ip, ctx.hourAgo) as number;
  const all = db.prepare('SELECT COUNT(*) FROM olk_responses WHERE link_id = ?').pluck().get(l.id) as number;
  if (recent >= ANSWERS_PER_SENDER_PER_HOUR || all >= ANSWERS_PER_LINK) throw new AppError('TOO_MANY', 'Too many answers from here just now. Please wait a while, or message the shop.', 429);
  const v = checked(db, l, raw);
  const id = newId();
  const key = randomBytes(18).toString('base64url');
  db.prepare('INSERT INTO olk_responses (id, link_id, edit_hash, name, gender, mobile, email, address, ip, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, l.id, hash(key), v.name, v.gender, v.mobile, v.email.toLowerCase(), v.address, ctx.ip, ctx.at, ctx.at);
  saveVersion(db, id, 1, v);
  return { key, ...answerOf(db, id) };
}

const responseByKey = (db: Db, l: LinkRow, key: string) =>
  db.prepare('SELECT id FROM olk_responses WHERE link_id = ? AND edit_hash = ?').pluck().get(l.id, hash(key)) as string | undefined;

/** An answer, by its key, to change it. */
export function myAnswer(db: Db, token: string, key: string) {
  const l = linkByToken(db, token);
  const id = l && responseByKey(db, l, key);
  if (!id) throw notFound('That answer');
  return answerOf(db, id);
}

/** Changes an answer, until the link closes: the whole answer again, as its next version. */
export function changeAnswer(db: Db, token: string, key: string, raw: unknown, ctx: { at: string; today: string }) {
  const l = linkByToken(db, token);
  const id = l && responseByKey(db, l, key);
  if (!l || !id) throw notFound('That answer');
  if (!isOpen(l, ctx.today)) throw conflict('LINK_CLOSED', 'This link is closed, so the answer cannot be changed. Please message the shop.');
  const v = checked(db, l, raw);
  const version = (db.prepare('SELECT version FROM olk_responses WHERE id = ?').pluck().get(id) as number) + 1;
  saveVersion(db, id, version, v);
  db.prepare('UPDATE olk_responses SET name = ?, gender = ?, mobile = ?, email = ?, address = ?, version = ?, updated_at = ? WHERE id = ?')
    .run(v.name, v.gender, v.mobile, v.email.toLowerCase(), v.address, version, ctx.at, id);
  return answerOf(db, id);
}

/** An answer as it stands (its latest version), measurements in inches. */
export function answerOf(db: Db, id: string) {
  const r = db.prepare('SELECT * FROM olk_responses WHERE id = ?').get(id) as
    { id: string; name: string; gender: 'female' | 'male'; mobile: string; email: string; address: string; created_at: string; updated_at: string; version: number };
  const people = db.prepare('SELECT * FROM olk_people WHERE response_id = ? AND version = ? ORDER BY row_no').all(id, r.version) as
    { row_no: number; name: string | null; back_name: string | null; number: string | null; gender: 'female' | 'male'; measure_at_shop: number }[];
  const pieces = db.prepare('SELECT row_no, line_no, qty, size FROM olk_pieces WHERE response_id = ? AND version = ? ORDER BY row_no, line_no').all(id, r.version) as
    { row_no: number; line_no: number; qty: number; size: string | null }[];
  const measures = db.prepare('SELECT row_no, line_no, field, hundredths FROM olk_measures WHERE response_id = ? AND version = ?').all(id, r.version) as
    { row_no: number; line_no: number; field: Measure; hundredths: number }[];
  return {
    id: r.id, name: r.name, gender: r.gender, mobile: r.mobile, email: r.email, address: r.address, createdAt: r.created_at, updatedAt: r.updated_at, changes: r.version - 1,
    people: people.map((p) => ({
      row: p.row_no, ...(p.name ? { name: p.name } : {}), ...(p.back_name ? { backName: p.back_name } : {}), ...(p.number ? { number: p.number } : {}),
      gender: p.gender, measureAtShop: p.measure_at_shop === 1,
      pieces: pieces.filter((pc) => pc.row_no === p.row_no).map((pc) => ({ lineNo: pc.line_no, qty: pc.qty, ...(pc.size ? { size: pc.size } : {}) })),
      measures: Object.fromEntries(measures.filter((m) => m.row_no === p.row_no && m.line_no === 0).map((m) => [m.field, m.hundredths / 100])) as Partial<Record<Measure, number>>,
      itemMeasures: measures.filter((m) => m.row_no === p.row_no && m.line_no > 0).map((m) => ({ lineNo: m.line_no, field: m.field, value: m.hundredths / 100 })),
    })),
  };
}
