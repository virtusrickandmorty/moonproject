/**
 * The image tools' online AI (the owner's request, Oct 2026), paid per picture through Fal.ai: redraw a jersey photo as
 * flat print artwork (Best: Google Nano Banana Pro, the same model as the paid service the owner compared; Economy: FLUX
 * Kontext) and vectorize cleanly (Recraft). Owner-only (img.ai), with a monthly limit in pesos checked before each run
 * and every run logged with its cost. The Fal.ai key is write-only, as the assistant's (AIA) is: a locked file beside the
 * database, never in the database, an answer, a log line or the audit trail.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { AppError, conflict, newId } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';

/** US$ per picture, from Fal.ai's prices (Oct 2026); shown in pesos at the owner's rate. */
export const AI_MODELS = {
  best: { endpoint: 'fal-ai/nano-banana-pro/edit', mills: 150, label: 'Nano Banana Pro' },
  economy: { endpoint: 'fal-ai/flux-pro/kontext', mills: 40, label: 'FLUX Kontext' },
  vector: { endpoint: 'fal-ai/recraft/vectorize', mills: 11, label: 'Recraft' },
} as const;
export type Quality = 'best' | 'economy';

const FLAT = 'lay the printed pattern out flat as one rectangle, remove the jersey shape, collar, armholes, seams, folds, wrinkles, shadows and lighting.';
const CRISP = ' Keep the original artwork, colours and layout, redrawn with clean, crisp lines and sharp detail, like vector illustration.';

/**
 * The instructions, each tried on the owner's sample jersey (Oct 2026). Redraw: Nano Banana Pro gave the paid service's
 * result with the first; Kontext needs the text named outright to remove it. part front/back: one picture showing both
 * sides, one side taken out. The back made by the AI: the design continued over the whole back ("leave space for a name"
 * gave an empty white box), with the name and number when given.
 */
export function redrawPrompt(quality: Quality, removeText: boolean, part: 'whole' | 'front' | 'back' = 'whole', words: string[] = []): string {
  // The owner saw names and numbers left as shapes in the background's colour, and a designed team name kept as art:
  // every version of them is named, and the words themselves when the owner typed them.
  const named = words.length ? ` These words and numbers are on it: ${words.map((w) => `"${w}"`).join(', ')}; remove each of them completely.` : '';
  const text = removeText
    ? (quality === 'economy'
      ? ' Erase every word, letter, number and logo completely (names, numbers, brand logos) and continue the background artwork where they were.'
      : ' Remove all text, names, numbers and logos.')
      + named
      + ' Decorated or stylised lettering is text too. Leave no trace of their shapes: no outlines, drop shadows, embossed, faint, ghost or same-colour versions; draw the background pattern straight through where they were.'
    : ' Keep the names, numbers and logos as they are.';
  if (part !== 'whole') {
    const side = part === 'front' ? 'FRONT' : 'BACK';
    return `This picture shows the same jersey from the front and from the back. Take only the ${side} of the jersey and recreate its printed design as flat print artwork that fills the whole canvas edge to edge: ${FLAT}${text}${CRISP}`;
  }
  return `Recreate this sublimation jersey design as flat, front-facing print artwork that fills the whole canvas edge to edge: ${FLAT}${text}${CRISP}`;
}

export function backPrompt(name: string, number: string): string {
  const lettering = name || number
    ? ` Across the upper back, add${name ? ` the player name "${name}" in bold athletic block letters` : ''}${name && number ? ' and below it' : ''}${number ? ` the large number "${number}"` : ''}, in the jersey's colours with a contrasting outline.`
    : ' Do not add any text, letters or numbers.';
  return 'This is the flat print artwork of the FRONT of a sublimation jersey. Create the matching BACK of the same jersey as flat print artwork that fills the whole canvas edge to edge: '
    + 'the same artwork, colours and patterns, continuing the design as if it wraps around the body, with the artwork continuous over the whole back and no empty boxes or blank areas.'
    + lettering + ' No jersey shape, no folds, no shadows; clean, crisp lines and sharp detail, like vector illustration.';
}

export type Garment = 'jersey' | 'tshirt' | 'polo' | 'longsleeve';
const GARMENT: Record<Garment, string> = { jersey: 'sleeveless basketball jersey', tshirt: 'crew-neck T-shirt', polo: 'polo shirt with a collar and buttons', longsleeve: 'long-sleeve shirt' };

export function mockupPrompt(garment: Garment, withBack: boolean): string {
  return `Create a clean, realistic product mockup photo of one ${GARMENT[garment]} printed all over with this artwork: `
    + (withBack ? "the first image is the front print and the second image is the back print. Show the garment's front view on the left and its back view on the right, side by side, "
      : "the image is the front print. Show the garment's front view, ")
    + 'laid flat on a plain light grey background, with soft even studio lighting and realistic fabric. Keep the artwork exactly as given, fitted to the garment shape.';
}

export interface AiSettings { keySet: boolean; capPeso: number; ratePeso: number; version: number }
export const DEFAULT_CAP_PESO = 500;
export const DEFAULT_RATE_CENTAVOS = 5800;

export function keyFile(db: Db): string {
  const folder = process.env.MOONPROJECT_IMG_AI_DIR ?? (db.name === ':memory:' || db.name === '' ? join(tmpdir(), 'moonproject-img-ai') : dirname(db.name));
  return join(folder, 'fal-api-key.secret');
}
export function readFalKey(db: Db): string | null {
  try {
    return readFileSync(keyFile(db), 'utf8').replace(/^\uFEFF/, '').trim() || null; // Notepad may start the file with a BOM
  } catch {
    return null;
  }
}
function writeFalKey(db: Db, key: string): void {
  const file = keyFile(db);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${newId()}.tmp`;
  writeFileSync(tmp, key, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

function settingsRow(db: Db) {
  return db.prepare('SELECT monthly_cap_peso AS cap, rate_centavos AS rate, version FROM img_ai_settings WHERE id = 1').get() as { cap: number; rate: number; version: number } | undefined;
}
export function aiSettings(db: Db): AiSettings {
  const r = settingsRow(db);
  return { keySet: existsSync(keyFile(db)) && readFalKey(db) !== null, capPeso: r?.cap ?? DEFAULT_CAP_PESO, ratePeso: (r?.rate ?? DEFAULT_RATE_CENTAVOS) / 100, version: r?.version ?? 0 };
}

export const aiSettingsInput = z.object({
  capPeso: z.number().int().min(0).max(1_000_000),
  ratePeso: z.number().min(1).max(1000),
  /** Write-only: leave it out to keep the saved key; an empty string removes it. */
  apiKey: z.string().trim().max(400).optional(),
  version: z.number().int().min(0),
}).strict();

export function saveAiSettings(db: Db, raw: unknown, who: { userId: string; at: string }): AiSettings {
  const v = aiSettingsInput.parse(raw);
  const before = aiSettings(db);
  if (v.version !== before.version) throw conflict('VERSION_CHANGED', 'Someone changed these settings meanwhile. Open them again.');
  const keyChange = v.apiKey === undefined ? null : v.apiKey === '' ? 'removed' : 'changed';
  if (keyChange) writeFalKey(db, v.apiKey ?? '');
  db.prepare(`INSERT INTO img_ai_settings (id, monthly_cap_peso, rate_centavos, version, updated_at, updated_by) VALUES (1, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET monthly_cap_peso = excluded.monthly_cap_peso, rate_centavos = excluded.rate_centavos,
      version = img_ai_settings.version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(v.capPeso, Math.round(v.ratePeso * 100), who.at, who.userId);
  const after = aiSettings(db);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'img.ai.settings', entityType: 'img_ai_settings', entityId: '1',
    data: { before: { capPeso: before.capPeso, ratePeso: before.ratePeso }, after: { capPeso: after.capPeso, ratePeso: after.ratePeso }, key: keyChange } });
  return after;
}

/** Pesos, to the centavo, of a cost in thousandths of a US$ at a rate in centavos. */
export const pesoOf = (mills: number, rateCentavos: number) => Math.round((mills * rateCentavos) / 1000) / 100;

export function spentThisMonth(db: Db, month: string): number {
  const rows = db.prepare('SELECT cost_mills AS mills, rate_centavos AS rate FROM img_ai_runs WHERE month = ? AND ok = 1').all(month) as { mills: number; rate: number }[];
  return Math.round(rows.reduce((s, r) => s + pesoOf(r.mills, r.rate), 0) * 100) / 100;
}

/** Refuses a run that would take the month past the limit (the cost is known before: one price per picture). */
export function checkCap(db: Db, month: string, mills: number): void {
  const s = aiSettings(db);
  if (!s.keySet) throw new AppError('IMG_AI_NO_KEY', 'The online AI has no Fal.ai key yet. The owner adds it under AI settings below.', 503);
  const rate = Math.round(s.ratePeso * 100);
  const spent = spentThisMonth(db, month);
  const cost = pesoOf(mills, rate);
  if (spent + cost > s.capPeso) {
    throw new AppError('IMG_AI_LIMIT', `This month's AI limit is ₱${s.capPeso.toFixed(2)} and ₱${spent.toFixed(2)} is used; this picture would cost about ₱${cost.toFixed(2)}. The owner can raise the limit under AI settings.`, 402);
  }
}

export type AiStep = 'redraw' | 'back' | 'mockup' | 'vectorize';
export function logRun(db: Db, run: { at: string; month: string; userId: string; step: AiStep; model: string; ok: boolean; mills: number; ms: number; note?: string; resultId?: string }): void {
  const rate = Math.round(aiSettings(db).ratePeso * 100);
  db.prepare(`INSERT INTO img_ai_runs (id, at, month, user_id, step, model, ok, cost_mills, rate_centavos, ms, note, result_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(newId(), run.at, run.month, run.userId, run.step, run.model, run.ok ? 1 : 0, run.ok ? run.mills : 0, rate, Math.round(run.ms), (run.note ?? '').slice(0, 300), run.resultId ?? null);
}

/** The latest runs; url: the picture's address while it is kept (three days), else null. */
export function recentRuns(db: Db, limit: number, urlOf: (resultId: string, step: string) => string | null) {
  return db.prepare(`SELECT r.at, r.step, r.model, r.ok, r.cost_mills AS mills, r.rate_centavos AS rate, r.ms, r.note, r.result_id AS resultId,
      COALESCE(u.display_name, u.username, '') AS who
    FROM img_ai_runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.at DESC, r.rowid DESC LIMIT ?`).all(limit)
    .map((r) => {
      const x = r as { at: string; step: string; model: string; ok: number; mills: number; rate: number; ms: number; note: string; resultId: string | null; who: string };
      return { at: x.at, step: x.step, model: x.model, ok: x.ok === 1, peso: pesoOf(x.mills, x.rate), seconds: Math.round(x.ms / 100) / 10, note: x.note, who: x.who,
        url: x.resultId ? urlOf(x.resultId, x.step) : null };
    });
}

/** The online service: one request in, the result's bytes out. Tests use a stand-in. */
export interface AiService { run(key: string, endpoint: string, input: Record<string, unknown>): Promise<Buffer> }

const QUEUE = 'https://queue.fal.run';
const TIMEOUT_MS = 4 * 60_000;

/** Fal.ai's queue: submit, wait for it, fetch the answer, download the first picture (or the SVG). */
export const falService: AiService = {
  async run(key, endpoint, input) {
    const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
    const fail = (status: number, body: string) => {
      if (/TOP_UP|locked/i.test(body)) return new AppError('IMG_AI_CREDIT', 'The Fal.ai account is out of credit. Top it up at fal.ai (Billing), then try again.', 402);
      if (status === 401 || status === 403) return new AppError('IMG_AI_KEY', 'Fal.ai did not accept the key. The owner can set it again under AI settings.', 502);
      return new AppError('IMG_AI_FAILED', `The online AI could not do this picture (${status}). Try again, or another option.`, 502);
    };
    const deadline = Date.now() + TIMEOUT_MS;
    const sub = await fetch(`${QUEUE}/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(input), signal: AbortSignal.timeout(60_000) });
    if (!sub.ok) throw fail(sub.status, await sub.text());
    const { status_url: statusUrl, response_url: responseUrl } = await sub.json() as { status_url: string; response_url: string };
    for (;;) {
      if (Date.now() > deadline) throw new AppError('IMG_AI_FAILED', 'The online AI took too long. Try again in a minute.', 504);
      const st = await fetch(statusUrl, { headers, signal: AbortSignal.timeout(30_000) });
      if (!st.ok) throw fail(st.status, await st.text());
      const { status } = await st.json() as { status: string };
      if (status === 'COMPLETED') break;
      if (status !== 'IN_QUEUE' && status !== 'IN_PROGRESS') throw fail(500, status);
      await new Promise((r) => setTimeout(r, 2000));
    }
    const res = await fetch(responseUrl, { headers, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    if (!res.ok) throw fail(res.status, text);
    const body = JSON.parse(text) as { images?: { url: string }[]; image?: { url: string } };
    const url = body.images?.[0]?.url ?? body.image?.url;
    if (!url) throw new AppError('IMG_AI_FAILED', 'The online AI gave no picture back (it may have refused this one). Try another photo.', 502);
    const file = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!file.ok) throw fail(file.status, '');
    return Buffer.from(await file.arrayBuffer());
  },
};
