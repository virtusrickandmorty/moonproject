/** The image tools' online AI (the owner's request, Oct 2026), with a stand-in for Fal.ai: nothing leaves the test. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { smallPng } from '../../../../test/pictures.ts';
import { useAiServiceForTests } from '../routes.ts';

let env: TestEnv;
let dir: string;
const calls: { endpoint: string; input: Record<string, unknown> }[] = [];
let fail: Error | null = null;
const KEY = 'test-key-id:test-key-secret-0123456789';

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'img-ai-'));
  process.env.MOONPROJECT_IMG_AI_DIR = dir;
  env = await createTestEnv();
  calls.length = 0; fail = null;
  useAiServiceForTests({
    run: async (_key, endpoint, input) => {
      calls.push({ endpoint, input });
      if (fail) throw fail;
      return endpoint.includes('recraft') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>') : smallPng();
    },
  });
});
afterEach(() => {
  useAiServiceForTests(null);
  delete process.env.MOONPROJECT_IMG_AI_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const run = async (query: string, who: Parameters<TestEnv['as']>[0] = 'owner') =>
  (await env.as(who)).post(`/api/img/ai/run?${query}`, smallPng(), { 'content-type': 'application/octet-stream' });
const settings = async () => (await (await env.as('owner')).get('/api/img/ai')).json() as {
  keySet: boolean; capPeso: number; ratePeso: number; version: number; spentPeso: number; prices: { best: number; economy: number; vector: number }; runs: { ok: boolean; peso: number; model: string; url: string | null }[];
};
const save = async (body: object) => (await env.as('owner')).put('/api/img/ai', body);

it('is the owner\'s only: others cannot see it or run it', async () => {
  for (const who of ['encoder', 'accountant', 'production'] as const) {
    expect((await (await env.as(who)).get('/api/img/ai')).statusCode).toBe(403);
    expect((await run('op=vector', who)).statusCode).toBe(403);
  }
});

it('shows prices in pesos, keeps the key write-only, and refuses to run without one', async () => {
  const s = await settings();
  expect(s).toMatchObject({ keySet: false, capPeso: 500, ratePeso: 58, spentPeso: 0, prices: { best: 8.7, economy: 2.32, vector: 0.64 } });
  expect((await run('op=redraw&quality=best&shape=tall&text=remove')).json()).toMatchObject({ code: 'IMG_AI_NO_KEY' });
  expect(calls).toHaveLength(0);

  expect((await save({ capPeso: 500, ratePeso: 58, apiKey: KEY, version: s.version })).statusCode).toBe(200);
  const after = await (await env.as('owner')).get('/api/img/ai');
  expect(after.json()).toMatchObject({ keySet: true });
  expect(after.body).not.toContain('test-key-secret');
  const audit = env.db.prepare("SELECT data FROM audit_log WHERE action = 'img.ai.settings'").pluck().all() as string[];
  expect(audit.join(' ')).not.toContain('test-key-secret');
  expect(audit.join(' ')).toContain('changed');
});

it('redraws and vectorizes through the service, logs what each cost, and stops at the month\'s limit', async () => {
  await save({ capPeso: 10, ratePeso: 58, apiKey: KEY, version: 0 });

  const r = await run('op=redraw&quality=best&shape=tall&text=remove');
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json()).toMatchObject({ costPeso: 8.7 });
  expect(calls[0]!.endpoint).toBe('fal-ai/nano-banana-pro/edit');
  expect(calls[0]!.input).toMatchObject({ aspect_ratio: '9:16', output_format: 'png' });
  expect(String(calls[0]!.input.prompt)).toContain('Remove all text');
  expect(String(calls[0]!.input.prompt)).toContain('no outlines, drop shadows, embossed, faint, ghost or same-colour versions');
  expect((calls[0]!.input.image_urls as string[])[0]).toMatch(/^data:image\/png;base64,/);
  const got = await (await env.as('owner')).get((r.json() as { url: string }).url);
  expect(got.headers['content-type']).toBe('image/png');

  // ₱8.70 used of ₱10: another redraw (₱8.70, or ₱2.32 economy) would pass the limit; a vector (₱0.64) fits.
  expect((await run('op=redraw&quality=best&shape=tall&text=remove')).json()).toMatchObject({ code: 'IMG_AI_LIMIT' });
  expect((await run('op=redraw&quality=economy&shape=square&text=keep')).json()).toMatchObject({ code: 'IMG_AI_LIMIT' });
  expect(calls).toHaveLength(1);
  const v = await run('op=vector');
  expect(v.statusCode, v.body).toBe(200);
  expect(calls[1]!.endpoint).toBe('fal-ai/recraft/vectorize');
  const svg = await (await env.as('owner')).get((v.json() as { url: string }).url);
  expect(svg.headers['content-type']).toBe('image/svg+xml');
  expect(svg.headers['content-security-policy']).toContain('sandbox');

  const s = await settings();
  expect(s.spentPeso).toBe(9.34);
  expect(s.runs.map((x) => [x.model, x.ok, x.peso])).toEqual([['Recraft', true, 0.64], ['Nano Banana Pro', true, 8.7]]);
  // A paid picture can be downloaded again from the list while it is kept.
  expect(s.runs.map((x) => x.url)).toEqual([(v.json() as { url: string }).url, (r.json() as { url: string }).url]);
  expect((await (await env.as('owner')).get(s.runs[1]!.url!)).statusCode).toBe(200);
});

it('a failed run is logged and costs nothing; Kontext is told to erase the text by name', async () => {
  await save({ capPeso: 100, ratePeso: 58, apiKey: KEY, version: 0 });
  fail = new Error('The Fal.ai account is out of credit.');
  expect((await run('op=redraw&quality=economy&shape=wide&text=remove')).statusCode).toBe(500);
  expect(calls[0]!.endpoint).toBe('fal-ai/flux-pro/kontext');
  expect(calls[0]!.input).toMatchObject({ aspect_ratio: '16:9' });
  expect(String(calls[0]!.input.prompt)).toContain('Erase every word, letter, number and logo');
  const s = await settings();
  expect(s.spentPeso).toBe(0);
  expect(s.runs[0]).toMatchObject({ ok: false, peso: 0, model: 'FLUX Kontext' });
});

it('Crisp redraws with GPT Image 2.5 at a size in pixels, priced at its estimate', async () => {
  await save({ capPeso: 100, ratePeso: 58, apiKey: KEY, version: 0 });
  expect((await settings()).prices).toMatchObject({ best: 8.7, crisp: 14.5, economy: 2.32 });
  const r = await run('op=redraw&quality=crisp&shape=tall&text=remove');
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json()).toMatchObject({ costPeso: 14.5 });
  expect(calls[0]!.endpoint).toBe('openai/gpt-image-2.5/sunburst/edit');
  expect(calls[0]!.input).toMatchObject({ image_size: { width: 1152, height: 2048 }, quality: 'high', output_format: 'png' });
  expect(calls[0]!.input).not.toHaveProperty('aspect_ratio');
  expect(String(calls[0]!.input.prompt)).toContain('Remove all text');
  expect((await settings()).runs[0]).toMatchObject({ ok: true, peso: 14.5, model: 'GPT Image 2.5' });
});

it('takes one side out of a picture showing both, makes the back with a name and number, and makes a mockup', async () => {
  await save({ capPeso: 100, ratePeso: 58, apiKey: KEY, version: 0 });
  expect((await run('op=redraw&quality=best&shape=tall&text=remove&part=back')).statusCode).toBe(200);
  expect(String(calls[0]!.input.prompt)).toContain('Take only the BACK of the jersey');

  const back = await run(`op=back&shape=tall&name=${encodeURIComponent('SON-OT')}&number=10`);
  expect(back.statusCode, back.body).toBe(200);
  expect(calls[1]!.endpoint).toBe('fal-ai/nano-banana-pro/edit');
  expect(String(calls[1]!.input.prompt)).toContain('the player name "SON-OT"');
  expect(String(calls[1]!.input.prompt)).toContain('the large number "10"');
  expect(String(calls[1]!.input.prompt)).toContain('no empty boxes');
  // No name or number: the design only; a name with odd characters or a long number is refused before any cost.
  expect((await run('op=back&shape=tall')).statusCode).toBe(200);
  expect(String(calls[2]!.input.prompt)).toContain('Do not add any text');
  expect((await run('op=back&shape=tall&name=%22%3Cx%3E')).statusCode).toBe(400);
  expect((await run('op=back&shape=tall&number=1234')).statusCode).toBe(400);
  expect(calls).toHaveLength(3);

  const png = `data:image/png;base64,${smallPng().toString('base64')}`;
  const mock = await (await env.as('owner')).post('/api/img/ai/mockup', { front: png, back: png, garment: 'polo' });
  expect(mock.statusCode, mock.body).toBe(200);
  expect(calls[3]!.input).toMatchObject({ aspect_ratio: '16:9' });
  expect((calls[3]!.input.image_urls as string[])).toHaveLength(2);
  expect(String(calls[3]!.input.prompt)).toContain('polo shirt');
  expect((await (await env.as('encoder')).post('/api/img/ai/mockup', { front: png, garment: 'jersey' })).statusCode).toBe(403);

  const s = await settings();
  expect(s.spentPeso).toBe(34.8); // four Best runs at ₱8.70
  expect(env.db.prepare('SELECT step FROM img_ai_runs ORDER BY rowid').pluck().all()).toEqual(['redraw', 'back', 'back', 'mockup']);
});

it('names the words the owner typed, so no trace of them is left', async () => {
  await save({ capPeso: 100, ratePeso: 58, apiKey: KEY, version: 0 });
  expect((await run(`op=redraw&quality=best&shape=tall&text=remove&words=${encodeURIComponent('SPARTANS, 23, Nike')}`)).statusCode).toBe(200);
  expect(String(calls[0]!.input.prompt)).toContain('These words and numbers are on it: "SPARTANS", "23", "Nike"');
  expect((await run(`op=redraw&quality=best&shape=tall&text=remove&words=${encodeURIComponent('<script>')}`)).statusCode).toBe(400);
});
