/**
 * The shop's own events for the website's decorations (the owner's request, Oct 2026: "a custom decoration for our own
 * event"): a shop anniversary, a sale weekend, intramurals season… Each has its dates, its banner's words, a colour
 * theme, the shop's own picture or one of the seasons' drawings, what drifts over the banner, the cards' doodles and
 * its button. While Decorations is Automatic, an event on today's date shows instead of the calendar's season. Kept
 * as master data: changed with a version (If-Match) and audited, hidden rather than deleted.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { sniffType } from '../../engine/attachments.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { tx, type Db } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';

export const THEMES = ['night', 'purple', 'festive', 'rose', 'ocean', 'gold', 'sunset', 'emerald'] as const;
export const ARTS = ['none', 'picture', 'halloween', 'christmas', 'valentines', 'summer', 'school'] as const;
export const SHOWERS = ['none', 'confetti', 'stars', 'hearts', 'snow', 'bats'] as const;
export const DOODLES = ['none', 'party', 'halloween', 'christmas', 'valentines', 'summer', 'school'] as const;
export const BUTTONS = ['quote', 'made', 'ready', 'services'] as const;
const MAX_PICTURE_BYTES = 1_500_000;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Type a date like 2026-11-15.');
const words = (max: number) => z.string().trim().min(1).max(max);
export const eventInput = z.object({
  name: words(60),
  startsOn: date,
  endsOn: date,
  eyebrow: words(40),
  title: words(40),
  highlight: z.string().trim().max(40).default(''),
  text: z.string().trim().max(220).default(''),
  barText: words(90),
  theme: z.enum(THEMES),
  art: z.enum(ARTS),
  shower: z.enum(SHOWERS),
  doodles: z.enum(DOODLES),
  button: z.enum(BUTTONS),
  buttonLabel: words(30),
  isActive: z.boolean().default(true),
  /** A new picture as a data URI (JPEG, PNG or WebP), or null to take it away; left out keeps it. */
  picture: z.string().max(2_100_000).nullable().optional(),
}).strict().refine((v) => v.endsOn >= v.startsOn, { message: 'The last day cannot be before the first.', path: ['endsOn'] });
export type EventInput = z.infer<typeof eventInput>;

type Row = {
  id: string; name: string; starts_on: string; ends_on: string; eyebrow: string; title: string; highlight: string; text: string; bar_text: string;
  theme: string; art: string; shower: string; doodles: string; button: string; button_label: string; picture_type: string | null; is_active: number; version: number;
};
const COLUMNS = 'id, name, starts_on, ends_on, eyebrow, title, highlight, text, bar_text, theme, art, shower, doodles, button, button_label, picture_type, is_active, version';
const shape = (r: Row) => ({
  id: r.id, name: r.name, startsOn: r.starts_on, endsOn: r.ends_on, eyebrow: r.eyebrow, title: r.title, highlight: r.highlight, text: r.text,
  barText: r.bar_text, theme: r.theme, art: r.art, shower: r.shower, doodles: r.doodles, button: r.button, buttonLabel: r.button_label,
  hasPicture: !!r.picture_type, isActive: r.is_active === 1, version: r.version,
});
export type ShopEvent = ReturnType<typeof shape>;

export const listEvents = (db: Db): ShopEvent[] => (db.prepare(`SELECT ${COLUMNS} FROM shp_season_events ORDER BY starts_on DESC, name`).all() as Row[]).map(shape);

/** The shown event on a day: active and within its dates; the one that started last wins. */
export function eventOfDay(db: Db, day: string): ShopEvent | null {
  const r = db.prepare(`SELECT ${COLUMNS} FROM shp_season_events WHERE is_active = 1 AND starts_on <= ? AND ends_on >= ? ORDER BY starts_on DESC, name LIMIT 1`).get(day, day) as Row | undefined;
  return r ? shape(r) : null;
}

function pictureOf(uri: string): { type: string; data: Buffer } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(uri);
  if (!m) throw new AppError('FILE_TYPE', 'Use a JPEG, PNG or WebP picture.', 415);
  const data = Buffer.from(m[2]!, 'base64');
  if (sniffType(data) !== m[1]) throw new AppError('FILE_TYPE', 'Use a JPEG, PNG or WebP picture.', 415);
  if (data.length > MAX_PICTURE_BYTES) throw new AppError('FILE_TOO_BIG', 'The picture is too big. Use one under 1.5 MB.', 413);
  return { type: m[1]!, data };
}

export function shpSeasonEventRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const opts = (permission: string) => ({ config: { permission }, bodyLimit: 2_200_000 });

  app.get('/api/shp/season/events', { config: { permission: 'shp.view' } }, async () => listEvents(db));

  /** An event's own picture, for the banner (anyone, while the event is shown on the website). */
  app.get<{ Params: { id: string } }>('/api/shp/season/events/:id/picture', { config: { permission: 'public' } }, async (req, reply) => {
    const r = db.prepare('SELECT picture_type AS type, picture AS data FROM shp_season_events WHERE id = ? AND is_active = 1').get(req.params.id) as { type: string | null; data: Buffer | null } | undefined;
    if (!r?.type || !r.data) throw notFound('The picture');
    return reply.header('content-type', r.type).header('x-content-type-options', 'nosniff').header('cache-control', 'public, max-age=300')
      .header('content-security-policy', "default-src 'none'; sandbox").send(r.data);
  });

  app.post('/api/shp/season/events', opts('shp.manage'), async (req) => {
    const v = eventInput.parse(req.body);
    const pic = v.picture ? pictureOf(v.picture) : null;
    if (v.art === 'picture' && !pic) throw new AppError('PICTURE', 'Add the picture for the banner, or pick a drawing.', 400);
    const at = stamp(clock), userId = currentUser(req).userId, id = newId();
    return tx(db, () => {
      db.prepare(`INSERT INTO shp_season_events (id, name, starts_on, ends_on, eyebrow, title, highlight, text, bar_text, theme, art, shower, doodles, button, button_label,
        picture_type, picture, is_active, version, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
        .run(id, v.name, v.startsOn, v.endsOn, v.eyebrow, v.title, v.highlight, v.text, v.barText, v.theme, v.art, v.shower, v.doodles, v.button, v.buttonLabel,
          pic?.type ?? null, pic?.data ?? null, v.isActive ? 1 : 0, at, userId, at, userId);
      appendAudit(db, { at, userId, action: 'shp.season.event.create', entityType: 'shp_season_events', entityId: id, data: { name: v.name, startsOn: v.startsOn, endsOn: v.endsOn, picture: !!pic } });
      return listEvents(db).find((e) => e.id === id)!;
    });
  });

  app.put<{ Params: { id: string } }>('/api/shp/season/events/:id', opts('shp.manage'), async (req) => {
    const v = eventInput.parse(req.body);
    const ifMatch = req.headers['if-match'];
    if (typeof ifMatch !== 'string' || !/^\d+$/.test(ifMatch)) throw new AppError('VERSION_REQUIRED', 'Open the event again before saving.', 428);
    const pic = v.picture ? pictureOf(v.picture) : null;
    const at = stamp(clock), userId = currentUser(req).userId;
    return tx(db, () => {
      const before = listEvents(db).find((e) => e.id === req.params.id);
      if (!before) throw notFound('The event');
      if (Number(ifMatch) !== before.version) throw conflict('VERSION_CHANGED', 'Someone changed this event meanwhile. Open it again.');
      const hasPicture = v.picture === undefined ? before.hasPicture : !!pic;
      if (v.art === 'picture' && !hasPicture) throw new AppError('PICTURE', 'Add the picture for the banner, or pick a drawing.', 400);
      db.prepare(`UPDATE shp_season_events SET name = ?, starts_on = ?, ends_on = ?, eyebrow = ?, title = ?, highlight = ?, text = ?, bar_text = ?, theme = ?, art = ?, shower = ?,
        doodles = ?, button = ?, button_label = ?, is_active = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?`)
        .run(v.name, v.startsOn, v.endsOn, v.eyebrow, v.title, v.highlight, v.text, v.barText, v.theme, v.art, v.shower, v.doodles, v.button, v.buttonLabel, v.isActive ? 1 : 0, at, userId, req.params.id);
      if (v.picture !== undefined) db.prepare('UPDATE shp_season_events SET picture_type = ?, picture = ? WHERE id = ?').run(pic?.type ?? null, pic?.data ?? null, req.params.id);
      appendAudit(db, { at, userId, action: 'shp.season.event.update', entityType: 'shp_season_events', entityId: req.params.id,
        data: { name: v.name, startsOn: v.startsOn, endsOn: v.endsOn, isActive: v.isActive, picture: v.picture === undefined ? 'kept' : pic ? 'changed' : 'removed' } });
      return listEvents(db).find((e) => e.id === req.params.id)!;
    });
  });
}
