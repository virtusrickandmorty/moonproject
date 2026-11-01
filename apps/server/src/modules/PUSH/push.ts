/**
 * Phone notifications (the owner's request, Nov 2026): a push to the installed app on a person's phone whenever something
 * new comes up in their bell (DASH notifications: an online payment to check, a support message, a job order overdue, a
 * bill or a tax form due…). Each person turns them on per phone; each notification is pushed once, and only those that
 * came up after they turned it on. Pushes go through the phone maker's push service (web push, VAPID keys kept in a
 * secret file beside the database); they carry the notification's words and link, never an amount.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import webpush from 'web-push';
import { z } from 'zod';
import { badRequest, newId } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { stamp, type Clock } from '../../platform/clock.ts';
import type { Registry } from '../../engine/documents/registry.ts';
import { userPermissions, type SessionUser } from '../../engine/security/sessions.ts';
import { notifications } from '../DASH/public.ts';

/** The VAPID keys: made once and kept beside the database (like the email App Password). */
export function vapidKeys(db: Db): { publicKey: string; privateKey: string } {
  const folder = process.env.MOONPROJECT_PUSH_DIR ?? (db.name === ':memory:' || db.name === '' ? join(tmpdir(), 'moonproject-push') : dirname(db.name));
  const file = join(folder, 'push-vapid.secret');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as { publicKey: string; privateKey: string };
  const keys = webpush.generateVAPIDKeys();
  mkdirSync(folder, { recursive: true });
  const tmp = `${file}.${newId()}.tmp`;
  writeFileSync(tmp, JSON.stringify(keys), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return keys;
}

export const subscriptionInput = z.object({
  endpoint: z.url().max(1000).refine((u) => u.startsWith('https://'), 'A push address starts with https://'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }).strict(),
  device: z.string().trim().max(200).default(''),
}).strict();

export const phonesOf = (db: Db, userId: string) =>
  db.prepare('SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ? AND is_active = 1').pluck().get(userId) as number;

/** Turns notifications on for one phone of the signed-in person; what is in their bell now counts as already pushed. */
export function subscribe(db: Db, clock: Clock, registry: Registry, user: SessionUser, raw: unknown) {
  const v = subscriptionInput.safeParse(raw);
  if (!v.success) throw badRequest('INVALID_INPUT', 'This phone did not give a push address the server can use.');
  const at = stamp(clock);
  const found = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').pluck().get(v.data.endpoint) as string | undefined;
  if (found) {
    db.prepare('UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, device = ?, is_active = 1, updated_at = ? WHERE id = ?')
      .run(user.userId, v.data.keys.p256dh, v.data.keys.auth, v.data.device, at, found);
  } else {
    db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, device, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), user.userId, v.data.endpoint, v.data.keys.p256dh, v.data.keys.auth, v.data.device, at, at);
  }
  const sent = db.prepare('INSERT OR IGNORE INTO push_sent (user_id, notification_key, sent_at) VALUES (?, ?, ?)');
  for (const n of notifications(db, clock, registry, user)) sent.run(user.userId, n.id, at);
  return { on: true, phones: phonesOf(db, user.userId) };
}

/** Turns notifications off for one phone of the signed-in person. */
export function unsubscribe(db: Db, clock: Clock, userId: string, endpoint: unknown) {
  if (typeof endpoint !== 'string') throw badRequest('INVALID_INPUT', 'Which phone?');
  db.prepare('UPDATE push_subscriptions SET is_active = 0, updated_at = ? WHERE endpoint = ? AND user_id = ?').run(stamp(clock), endpoint, userId);
  return { on: false, phones: phonesOf(db, userId) };
}

export type Phone = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
export type Sender = (phone: Phone, payload: string) => Promise<void>;

/** The real sender: web push with the shop's VAPID keys. */
export const webPushSender = (db: Db): Sender => {
  const keys = vapidKeys(db);
  return async (phone, payload) => {
    await webpush.sendNotification({ endpoint: phone.endpoint, keys: { p256dh: phone.p256dh, auth: phone.auth } }, payload,
      { vapidDetails: { subject: 'https://www.virtusgarments.com', publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 6 * 3600 });
  };
};

const phonesOfUser = (db: Db, userId: string) =>
  db.prepare('SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? AND is_active = 1').all(userId) as Phone[];

/** Sends one push to one phone; a phone the push service says is gone (404, 410) is switched off. Whether it went. */
async function deliver(db: Db, clock: Clock, send: Sender, phone: Phone, payload: object, log: (m: string) => void): Promise<boolean> {
  try {
    await send(phone, JSON.stringify(payload));
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) db.prepare('UPDATE push_subscriptions SET is_active = 0, updated_at = ? WHERE id = ?').run(stamp(clock), phone.id);
    else log(`Phone notifications: ${(e as Error).message}`.slice(0, 300));
    return false;
  }
}

const MAX_EACH = 4; // a burst of more becomes one "N new notifications"

/**
 * One pass: for each person with a phone turned on, the notifications in their bell not yet pushed (and not read) go
 * to each of their phones, up to four one by one, more as one summary. Returns how many pushes went.
 */
export async function pushNew(db: Db, clock: Clock, registry: Registry, send: Sender, log: (m: string) => void = () => {}): Promise<number> {
  const users = db.prepare('SELECT DISTINCT user_id FROM push_subscriptions WHERE is_active = 1 ORDER BY user_id').pluck().all() as string[];
  const sentBefore = db.prepare('SELECT 1 FROM push_sent WHERE user_id = ? AND notification_key = ?').pluck();
  const mark = db.prepare('INSERT OR IGNORE INTO push_sent (user_id, notification_key, sent_at) VALUES (?, ?, ?)');
  let count = 0;
  for (const userId of users) {
    const u = db.prepare('SELECT username, display_name AS displayName, is_active AS active FROM users WHERE id = ?').get(userId) as
      | { username: string; displayName: string; active: number }
      | undefined;
    if (!u?.active) continue;
    const { roles, permissions } = userPermissions(db, userId);
    const user: SessionUser = { sessionId: 'push', userId, username: u.username, displayName: u.displayName, csrfToken: '', mustChangePassword: false, permissions, roles, stepUpAt: null };
    const fresh = notifications(db, clock, registry, user).filter((n) => !n.read && !sentBefore.get(userId, n.id));
    if (fresh.length === 0) continue;
    const payloads = fresh.length > MAX_EACH
      ? [{ title: `${fresh.length} new notifications`, body: fresh.slice(0, 3).map((n) => n.label).join(' · '), href: '/dash/notifications', tag: 'many' }]
      : fresh.map((n) => ({ title: n.label, body: n.detail ?? '', href: n.href ?? '/dash/notifications', tag: n.id }));
    for (const phone of phonesOfUser(db, userId)) for (const p of payloads) if (await deliver(db, clock, send, phone, p, log)) count++;
    const at = stamp(clock);
    for (const n of fresh) mark.run(userId, n.id, at);
  }
  return count;
}

/** A test push to the signed-in person's phones, so they see it works. */
export async function pushTest(db: Db, clock: Clock, send: Sender, user: Pick<SessionUser, 'userId' | 'displayName'>) {
  const phones = phonesOfUser(db, user.userId);
  let sent = 0;
  for (const p of phones) {
    const payload = { title: 'Notifications are on', body: `Virtus will tell ${user.displayName} here when something needs doing.`, href: '/dash/notifications', tag: 'test' };
    if (await deliver(db, clock, send, p, payload, () => {})) sent++;
  }
  return { sent, phones: phones.length };
}
