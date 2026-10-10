/**
 * The assistant's settings (the owner's request, Oct 2026): on or off, its greeting, and what the owner tells it about the
 * shop. The AI service's API key is write-only, as the email App Password is (COM): a file in the data folder that only
 * the service account can read (mode 0600), never in the database, an API answer, a log line or the audit trail.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { conflict, newId } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';

export interface AiaSettings { isOn: boolean; greeting: string; knowledge: string; version: number; keySet: boolean }

export const DEFAULT_GREETING = 'Hi! I can help with our products, prices, how to order, and where your order is. What would you like to know?';
/** Empty until the owner writes it (the screen shows examples as a hint, so none are taken for facts). */
export const DEFAULT_KNOWLEDGE = '';

/** Where the API key file lives: the folder of the database file (the app's data folder). */
export function keyFile(db: Db): string {
  const folder = process.env.MOONPROJECT_AIA_DIR ?? (db.name === ':memory:' || db.name === '' ? join(tmpdir(), 'moonproject-aia') : dirname(db.name));
  return join(folder, 'aia-api-key.secret');
}
export function readApiKey(db: Db): string | null {
  try {
    return readFileSync(keyFile(db), 'utf8').trim() || null;
  } catch {
    return null;
  }
}
function writeApiKey(db: Db, key: string): void {
  const file = keyFile(db);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${newId()}.tmp`;
  writeFileSync(tmp, key, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

export function aiaSettings(db: Db): AiaSettings {
  const r = db.prepare('SELECT is_on, greeting, knowledge, version FROM aia_settings WHERE id = 1').get() as { is_on: number; greeting: string; knowledge: string; version: number } | undefined;
  const keySet = existsSync(keyFile(db)) && readApiKey(db) !== null;
  return r ? { isOn: r.is_on === 1, greeting: r.greeting, knowledge: r.knowledge, version: r.version, keySet }
    : { isOn: false, greeting: DEFAULT_GREETING, knowledge: DEFAULT_KNOWLEDGE, version: 0, keySet };
}

export const settingsInput = z.object({
  isOn: z.boolean(),
  greeting: z.string().trim().min(1).max(300),
  knowledge: z.string().trim().max(20000),
  /** Write-only: leave it out to keep the saved key; an empty string removes it. */
  apiKey: z.string().trim().max(400).optional(),
  version: z.number().int().min(0),
}).strict();

/** Saves the settings (version-checked); the audit row says only whether the key changed, never the key. */
export function saveAiaSettings(db: Db, raw: unknown, who: { userId: string; at: string }): AiaSettings {
  const v = settingsInput.parse(raw);
  const before = aiaSettings(db);
  if (v.version !== before.version) throw conflict('VERSION_CHANGED', 'Someone changed these settings meanwhile. Open them again.');
  const keyChange = v.apiKey === undefined ? null : v.apiKey === '' ? 'removed' : 'changed';
  if (v.isOn && !before.keySet && keyChange !== 'changed') throw conflict('NO_KEY', 'Add the AI service key before switching the assistant on.');
  if (keyChange === 'changed') writeApiKey(db, v.apiKey!);
  if (keyChange === 'removed') writeApiKey(db, '');
  const isOn = keyChange === 'removed' ? false : v.isOn;
  db.prepare(`INSERT INTO aia_settings (id, is_on, greeting, knowledge, version, updated_at, updated_by) VALUES (1, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET is_on = excluded.is_on, greeting = excluded.greeting, knowledge = excluded.knowledge,
      version = aia_settings.version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(isOn ? 1 : 0, v.greeting, v.knowledge, who.at, who.userId);
  const after = aiaSettings(db);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'aia.settings', entityType: 'aia_settings', entityId: '1',
    data: { before: { isOn: before.isOn, greeting: before.greeting, knowledgeLength: before.knowledge.length }, after: { isOn: after.isOn, greeting: after.greeting, knowledgeLength: after.knowledge.length }, key: keyChange } });
  return after;
}
