/**
 * Players fill in their own details for the coach (the owner's request, Nov 2026). On a team list the coach makes a link for
 * the players; each player opens it and sends their own row (name on the back, number, gender, sizes or measurements). The
 * rows go to the coach's list, never to the shop: the coach checks them, may change or take them off, and only the coach
 * sends the whole list (the answer, as before). A player sees only their own row.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError, badRequest, conflict, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { CLIENT_KEY, checkPerson, checkingOf, clientKeyOf, linkRow, personInput, type LinkRow, type PersonInput } from './links.ts';

const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const LISTS_PER_SENDER_PER_HOUR = 10;
const ENTRIES_PER_SENDER_PER_HOUR = 60;
const ENTRIES_PER_LIST = 500;
export interface Ctx { at: string; today: string; ip: string; hourAgo: string }

const linkByToken = (db: Db, token: string) => {
  const id = db.prepare('SELECT id FROM olk_links WHERE token = ?').pluck().get(token) as string | undefined;
  return id ? linkRow(db, id)! : undefined;
};
const open = (l: LinkRow, today: string) => !l.closed_at && l.closes_on >= today;
function teamLink(db: Db, token: string, today: string) {
  const l = linkByToken(db, token);
  if (!l) throw notFound('That order link');
  if (l.kind !== 'team') throw conflict('NOT_TEAM', 'Only a team list has a link for the players.');
  if (!open(l, today)) throw conflict('LINK_CLOSED', 'This link is closed. Please message the shop.');
  return l;
}

type ListRow = { id: string; link_id: string; player_token: string; coach_name: string | null };
const listByCoach = (db: Db, l: LinkRow, key: string) =>
  db.prepare('SELECT id, link_id, player_token, coach_name FROM olk_team_lists WHERE link_id = ? AND coach_hash = ?').get(l.id, hash(key)) as ListRow | undefined;
const listByPlayers = (db: Db, l: LinkRow, playerToken: string) =>
  db.prepare('SELECT id, link_id, player_token, coach_name FROM olk_team_lists WHERE link_id = ? AND player_token = ?').get(l.id, playerToken) as ListRow | undefined;

/** The coach starts a list for the players: the coach's own key, and the link for the players. */
export function startTeamList(db: Db, token: string, raw: unknown, ctx: Ctx) {
  const l = teamLink(db, token, ctx.today);
  const v = z.object({ coachName: z.string().trim().max(120).optional() }).strict().parse(raw ?? {});
  const recent = db.prepare('SELECT COUNT(*) FROM olk_team_lists WHERE ip = ? AND created_at >= ?').pluck().get(ctx.ip, ctx.hourAgo) as number;
  if (recent >= LISTS_PER_SENDER_PER_HOUR) throw new AppError('TOO_MANY', 'Too many lists from here just now. Please wait a while, or message the shop.', 429);
  const key = randomBytes(18).toString('base64url');
  const playerToken = randomBytes(18).toString('base64url');
  const id = newId();
  db.prepare('INSERT INTO olk_team_lists (id, link_id, coach_hash, player_token, coach_name, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, l.id, hash(key), playerToken, v.coachName || null, ctx.ip, ctx.at);
  appendAudit(db, { at: ctx.at, userId: null, action: 'olk.team.started', entityType: 'olk.link', entityId: l.id, data: { list: id } });
  return { key, playerToken, coachName: v.coachName || null };
}

type EntryRow = { id: string; person: string; created_at: string; updated_at: string; in_answer_at: string | null };
const entryOut = (e: EntryRow) => ({ id: e.id, person: JSON.parse(e.person) as PersonInput, sentAt: e.created_at, updatedAt: e.updated_at, onList: !!e.in_answer_at });

/** The coach's list: the link for the players and every row the players sent (those the coach took off are left out). */
export function teamList(db: Db, token: string, key: string) {
  const l = linkByToken(db, token);
  const list = l && listByCoach(db, l, key);
  if (!l || !list) throw notFound('That list');
  const entries = db.prepare('SELECT id, person, created_at, updated_at, in_answer_at FROM olk_team_entries WHERE list_id = ? AND removed_at IS NULL ORDER BY created_at, rowid').all(list.id) as EntryRow[];
  return { playerToken: list.player_token, coachName: list.coach_name, entries: entries.map(entryOut) };
}

/** The coach takes a player's row off their list (it is kept, marked taken off). */
export function removeEntry(db: Db, token: string, key: string, entryId: string, at: string) {
  const l = linkByToken(db, token);
  const list = l && listByCoach(db, l, key);
  if (!l || !list) throw notFound('That list');
  const done = db.prepare('UPDATE olk_team_entries SET removed_at = ? WHERE id = ? AND list_id = ? AND removed_at IS NULL').run(at, entryId, list.id);
  if (!done.changes) throw notFound("That player's details");
  appendAudit(db, { at, userId: null, action: 'olk.team.entry_removed', entityType: 'olk.link', entityId: l.id, data: { list: list.id, entry: entryId } });
  return teamList(db, token, key);
}

/** When the coach sends the list: the players' rows on it are stamped (the coach's key must be theirs). */
export function stampOnList(db: Db, token: string, raw: unknown, at: string) {
  const team = (raw as { team?: { key?: unknown; entries?: unknown } } | null)?.team;
  if (!team || typeof team.key !== 'string' || !Array.isArray(team.entries)) return;
  const l = linkByToken(db, token);
  const list = l && db.prepare('SELECT id FROM olk_team_lists WHERE link_id = ? AND coach_hash = ?').pluck().get(l.id, hash(team.key)) as string | undefined;
  if (!list) return;
  const stamp = db.prepare('UPDATE olk_team_entries SET in_answer_at = ? WHERE id = ? AND list_id = ? AND removed_at IS NULL');
  for (const id of team.entries) if (typeof id === 'string') stamp.run(at, id, list);
}

// ---- The player's side ----------------------------------------------------------------------------------------------

/** What a player's link says: who asked (the coach's name, if given). */
export function playerInvite(db: Db, token: string, playerToken: string) {
  const l = linkByToken(db, token);
  const list = l && listByPlayers(db, l, playerToken);
  if (!l || !list) throw notFound('That link for the players');
  return { coachName: list.coach_name };
}

const entryInput = personInput.omit({ row: true }).extend({ clientKey: CLIENT_KEY.optional() });
function checkedEntry(db: Db, l: LinkRow, raw: unknown): PersonInput {
  const parsed = entryInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0]!;
    throw badRequest('INVALID_INPUT', `Please check ${first.path.join(' ') || 'the form'}: ${first.message}`);
  }
  const { clientKey: _key, ...person } = parsed.data;
  const p = { ...person, row: 1 };
  const { items, sizes } = checkingOf(db, l.id);
  checkPerson('team', items, sizes, p);
  return p;
}

/** A player sends their own row to the coach; returns the key that changes it later (only its hash is kept). */
export function sendEntry(db: Db, token: string, playerToken: string, raw: unknown, ctx: Ctx) {
  const l = teamLink(db, token, ctx.today);
  const list = listByPlayers(db, l, playerToken);
  if (!list) throw notFound('That link for the players');
  // Sent again with the same key (the phone retried): the row already here, not a second one.
  const again = clientKeyOf(raw);
  if (again && entryByKey(db, l, playerToken, again)) return { key: again, ...myEntry(db, token, playerToken, again) };
  const recent = db.prepare('SELECT COUNT(*) FROM olk_team_entries WHERE ip = ? AND created_at >= ?').pluck().get(ctx.ip, ctx.hourAgo) as number;
  const all = db.prepare('SELECT COUNT(*) FROM olk_team_entries WHERE list_id = ?').pluck().get(list.id) as number;
  if (recent >= ENTRIES_PER_SENDER_PER_HOUR || all >= ENTRIES_PER_LIST) throw new AppError('TOO_MANY', 'Too many from here just now. Please wait a while, or tell your coach.', 429);
  const p = checkedEntry(db, l, raw);
  const key = again ?? randomBytes(18).toString('base64url');
  const id = newId();
  db.prepare('INSERT INTO olk_team_entries (id, list_id, edit_hash, person, ip, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, list.id, hash(key), JSON.stringify(p), ctx.ip, ctx.at, ctx.at);
  appendAudit(db, { at: ctx.at, userId: null, action: 'olk.team.entry_sent', entityType: 'olk.link', entityId: l.id, data: { list: list.id, entry: id } });
  return { key, ...myEntry(db, token, playerToken, key) };
}

const entryByKey = (db: Db, l: LinkRow, playerToken: string, key: string) => {
  const list = listByPlayers(db, l, playerToken);
  return list ? db.prepare('SELECT id, person, created_at, updated_at, in_answer_at, removed_at FROM olk_team_entries WHERE list_id = ? AND edit_hash = ?')
    .get(list.id, hash(key)) as (EntryRow & { removed_at: string | null }) | undefined : undefined;
};

/** A player's own row, by their key. */
export function myEntry(db: Db, token: string, playerToken: string, key: string) {
  const l = linkByToken(db, token);
  const e = l && entryByKey(db, l, playerToken, key);
  if (!l || !e) throw notFound('Your details');
  return { ...entryOut(e), takenOff: !!e.removed_at, coachName: listByPlayers(db, l, playerToken)!.coach_name };
}

/** A player changes their own row while the link is open (not once the coach took it off or sent it on the list). */
export function changeEntry(db: Db, token: string, playerToken: string, key: string, raw: unknown, ctx: { at: string; today: string }) {
  const l = teamLink(db, token, ctx.today);
  const e = entryByKey(db, l, playerToken, key);
  if (!e) throw notFound('Your details');
  if (e.removed_at) throw conflict('TAKEN_OFF', 'Your coach took your details off the list. Please talk to your coach.');
  if (e.in_answer_at) throw conflict('ON_LIST', 'Your coach has sent the team list with your details. To change them now, tell your coach.');
  const p = checkedEntry(db, l, raw);
  db.prepare('UPDATE olk_team_entries SET person = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(p), ctx.at, e.id);
  appendAudit(db, { at: ctx.at, userId: null, action: 'olk.team.entry_changed', entityType: 'olk.link', entityId: l.id, data: { entry: e.id } });
  return myEntry(db, token, playerToken, key);
}
