/**
 * The website's seasonal decorations (the owner's request, Oct 2026: "we will decorate our shop regularly depending on
 * the seasons of the month"). A calendar of seasons, each between two days of the year (Manila); the owner picks
 * Automatic (the season of today, if any), Off, or one season to show now. The website reads only which season shows;
 * its look (banner slide, top bar message, decorations) lives in the web app. The setting is versioned and audited.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { conflict } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { tx, type Db } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { eventOfDay, listEvents, type ShopEvent } from './season-events.ts';

/** From and to are MM-DD, both days included; a season may run over the new year (from after to). First match wins. */
export const SEASONS = [
  { key: 'halloween', label: 'Halloween and Undas', from: '10-15', to: '11-02' },
  { key: 'christmas', label: 'Christmas and New Year', from: '11-03', to: '01-06' },
  { key: 'valentines', label: "Valentine's Day", from: '02-01', to: '02-14' },
  { key: 'summer', label: 'Summer', from: '03-15', to: '05-31' },
  { key: 'school', label: 'Back to school', from: '06-01', to: '07-15' },
] as const;
export type SeasonKey = (typeof SEASONS)[number]['key'];
export const MODES = ['auto', 'off', ...SEASONS.map((s) => s.key)] as [string, ...string[]];

/** The season of a day (YYYY-MM-DD) by the calendar, or null. */
export function seasonOfDay(date: string): SeasonKey | null {
  const md = date.slice(5);
  const hit = SEASONS.find((s) => (s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to));
  return hit?.key ?? null;
}

function setting(db: Db): { mode: string; version: number } {
  const r = db.prepare('SELECT mode, version FROM shp_season_settings ORDER BY version DESC LIMIT 1').get() as { mode: string; version: number } | undefined;
  return r ?? { mode: 'auto', version: 0 };
}

/**
 * The shop's own event shown today: while Decorations is Automatic, an event on today's date shows instead of the
 * calendar's season (the owner's own events, Oct 2026); a season picked by hand, or Off, shows no event.
 */
export function eventShown(db: Db, date: string): ShopEvent | null {
  return setting(db).mode === 'auto' ? eventOfDay(db, date) : null;
}

/** What the website shows today: the owner's pick, or the calendar's season when Automatic; null when none or Off. */
export function seasonShown(db: Db, date: string): SeasonKey | null {
  const { mode } = setting(db);
  if (mode === 'off') return null;
  if (mode === 'auto') return seasonOfDay(date);
  return SEASONS.some((s) => s.key === mode) ? (mode as SeasonKey) : null;
}

const settingInput = z.object({ mode: z.enum(MODES), version: z.number().int().min(0) }).strict();

export function shpSeasonRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  /** The website: the season to decorate for now, or null. */
  app.get('/api/shp/season', { config: { permission: 'public' } }, async () => {
    const date = today(clock);
    const event = eventShown(db, date);
    // An event shows instead of the season; only what the website needs of it (its version keys the picture).
    return event ? { season: null, event: { ...event, isActive: undefined, name: undefined, startsOn: undefined, endsOn: undefined } } : { season: seasonShown(db, date), event: null };
  });
  /** Staff: the setting, what shows today, and the calendar. */
  app.get('/api/shp/season/settings', { config: { permission: 'shp.view' } }, async () => {
    const date = today(clock);
    return { ...setting(db), shownToday: seasonShown(db, date), eventToday: eventShown(db, date)?.name ?? null, calendarToday: seasonOfDay(date), seasons: SEASONS, events: listEvents(db) };
  });
  app.put('/api/shp/season/settings', { config: { permission: 'shp.manage' } }, async (req) => {
    const v = settingInput.parse(req.body);
    const at = stamp(clock);
    const userId = currentUser(req).userId;
    return tx(db, () => {
      const before = setting(db);
      if (v.version !== before.version) throw conflict('VERSION_CHANGED', 'Someone changed the decorations meanwhile. Open them again.');
      db.prepare('INSERT INTO shp_season_settings (version, mode, saved_by, saved_at) VALUES (?, ?, ?, ?)').run(before.version + 1, v.mode, userId, at);
      appendAudit(db, { at, userId, action: 'shp.season', entityType: 'shp_season_settings', entityId: String(before.version + 1), data: { before: before.mode, after: v.mode } });
      const date = today(clock);
      return { ...setting(db), shownToday: seasonShown(db, date), eventToday: eventShown(db, date)?.name ?? null, calendarToday: seasonOfDay(date), seasons: SEASONS, events: listEvents(db) };
    });
  });
}
