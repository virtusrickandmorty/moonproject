/**
 * The website's AI assistant (the owner's request, Oct 2026), with a stand-in for the AI service so nothing leaves the
 * machine: off until the owner adds a key and switches it on; answers through the shop's lookups (a price-list estimate);
 * keeps the chat; hands it to the Support inbox once; keeps the key out of every answer and the audit; and is bounded.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestEnv, PASSWORD, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { today } from '../../../platform/clock.ts';
import { useTransport, type ModelReply } from '../agent.ts';

let env: TestEnv;
let owner: Client;
let seen: Record<string, unknown>[];
let replies: ModelReply[];
beforeEach(async () => {
  process.env.MOONPROJECT_AIA_DIR = mkdtempSync(join(tmpdir(), 'aia-'));
  env = await createTestEnv();
  owner = await env.as('owner');
  seen = [];
  replies = [];
  useTransport(async (body, key) => {
    expect(key).toBe('sk-test-key');
    seen.push(JSON.parse(JSON.stringify(body)) as unknown as Record<string, unknown>);
    return replies.shift()!;
  });
});
afterEach(async () => { useTransport(null); await env.app.close(); env.db.close(); });

const publicPost = (url: string, payload: object) => env.app.inject({ method: 'POST', url, payload, remoteAddress: '203.0.113.7' });
const settings = async (body: object) => {
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const v = (await owner.get('/api/aia/settings')).json().version as number;
  return owner.put('/api/aia/settings', { greeting: 'Hi! Ask me about our jerseys.', knowledge: 'Open Monday to Saturday, 9 to 6.', version: v, ...body });
};

it('stays off until the owner adds a key and switches it on; the key never comes back', async () => {
  expect((await env.app.inject({ method: 'GET', url: '/api/aia/public' })).json()).toMatchObject({ on: false });
  const off = (await publicPost('/api/aia/chat', { message: 'Magkano po ang jersey?' })).json();
  expect(off.offerPerson).toBe(true);
  expect(off.reply).toContain('send your question to our staff');
  expect(seen).toHaveLength(0);

  expect((await settings({ isOn: true })).json().code).toBe('NO_KEY');
  const on = await settings({ isOn: true, apiKey: 'sk-test-key' });
  expect(on.statusCode, on.body).toBe(200);
  expect(on.body).not.toContain('sk-test-key');
  expect((await owner.get('/api/aia/settings')).json()).toMatchObject({ isOn: true, keySet: true });
  expect((await owner.get('/api/aia/settings')).body).not.toContain('sk-test-key');
  expect(readFileSync(join(process.env.MOONPROJECT_AIA_DIR!, 'aia-api-key.secret'), 'utf8')).toBe('sk-test-key');
  expect(JSON.stringify(env.db.prepare("SELECT data FROM audit_log WHERE action = 'aia.settings'").all())).not.toContain('sk-test-key');
  expect((await env.app.inject({ method: 'GET', url: '/api/aia/public' })).json()).toEqual({ on: true, greeting: 'Hi! Ask me about our jerseys.' });
});

it('answers through the price list as an estimate, keeps the chat, and hands it to the Support inbox once', async () => {
  const item = (await owner.post('/api/cat/items', { code: 'NBA-1', name: 'NBA Cut Jersey Set', class: 'made_to_order_garment', garmentType: 'Jersey (NBA cut)', unit: 'set', setComponents: 2 })).json().id as string;
  for (const [minQty, cents, v] of [[1, 90_000, '1'], [10, 80_000, '2']] as const) {
    const pr = await owner.post(`/api/cat/items/${item}/prices`, { effectiveFrom: today(env.clock), minQty, unitPriceCents: cents }, { 'if-match': v });
    expect(pr.statusCode, pr.body).toBe(200);
  }
  await settings({ isOn: true, apiKey: 'sk-test-key' });
  replies.push(
    { parts: [{ functionCall: { id: 't1', name: 'price_estimate', args: { item: 'nba jersey set', qty: 15 } }, thoughtSignature: 'sig-1' }], usage: { input: 900, output: 40 } },
    { parts: [{ text: 'Mga ₱12,000 po para sa 15 sets (estimate lang po).' }], usage: { input: 1000, output: 30 } },
  );
  const first = (await publicPost('/api/aia/chat', { message: 'Magkano 15 NBA jersey sets?' })).json();
  expect(first).toMatchObject({ reply: 'Mga ₱12,000 po para sa 15 sets (estimate lang po).', offerPerson: false });
  // The model got the shop's rules and the owner's words, then the estimate from the price list (tier 10+ at ₱800),
  // with its own call sent back as given (Gemini needs the thought signature).
  expect(String(seen[0]!.system)).toContain('Open Monday to Saturday');
  expect(String(seen[0]!.system)).toContain('ESTIMATE');
  expect(JSON.stringify(seen[1]!.contents)).toContain('"thoughtSignature":"sig-1"');
  expect(JSON.stringify(seen[1]!.contents)).toContain('ESTIMATE: 15 × NBA Cut Jersey Set at ₱800.00 each');
  expect(JSON.stringify(seen[1]!.contents)).toContain('₱12,000.00');
  expect(JSON.stringify(seen[1]!.contents)).toContain('"functionResponse":{"id":"t1","name":"price_estimate"');

  // The customer asks for a person: the model offers the form.
  replies.push(
    { parts: [{ functionCall: { id: 't2', name: 'talk_to_person', args: { reason: 'custom design' } } }] },
    { parts: [{ text: 'Sige po, fill up lang po ang form sa baba.' }] },
  );
  const second = (await publicPost('/api/aia/chat', { chatId: first.chatId, message: 'Pwede po makausap ang tao?' })).json();
  expect(second.offerPerson).toBe(true);
  expect(env.db.prepare('SELECT role, input_tokens AS i FROM aia_messages WHERE chat_id = ? ORDER BY seq').all(first.chatId)).toEqual([
    { role: 'customer', i: null }, { role: 'assistant', i: 1900 }, { role: 'customer', i: null }, { role: 'assistant', i: 0 },
  ]);

  const handoff = { chatId: first.chatId, name: 'Juan Dela Cruz', email: 'juan@example.test', phone: '0917 123 4567', consent: true };
  expect((await publicPost('/api/aia/handoff', { ...handoff, phone: '12' })).json().code).toBe('PHONE_REQUIRED');
  const sent = (await publicPost('/api/aia/handoff', handoff)).json();
  expect(sent.number).toMatch(/^SUP-\d{6}$/);
  expect((await publicPost('/api/aia/handoff', handoff)).json().number).toBe(sent.number); // once per chat
  const sup = env.db.prepare('SELECT kind, subject, message FROM sup_messages WHERE number = ?').get(sent.number) as { kind: string; subject: string; message: string };
  expect(sup).toMatchObject({ kind: 'inquiry', subject: 'From the website chat' });
  expect(sup.message).toContain('Customer: Magkano 15 NBA jersey sets?');
  expect(sup.message).toContain('Assistant: Sige po');

  const list = (await owner.get('/api/aia/chats')).json();
  expect(list.rows[0]).toMatchObject({ messages: 4, supportNumber: sent.number, inputTokens: 1900, outputTokens: 70 });
});

it('tests the saved key for the owner, and says what went wrong without the key', async () => {
  expect((await owner.post('/api/aia/test', {})).json()).toEqual({ ok: false, message: 'No key is saved yet.' });
  await settings({ isOn: false, apiKey: 'sk-test-key' });
  replies.push({ parts: [{ text: 'Hello po!' }], model: 'gemini-3.5-flash' });
  expect((await owner.post('/api/aia/test', {})).json()).toEqual({ ok: true, model: 'gemini-3.5-flash', reply: 'Hello po!' });
  useTransport(async (_b, key) => { throw new Error(`Google AI Studio answered 400: API key not valid (${key})`); });
  const bad = (await owner.post('/api/aia/test', {})).json();
  expect(bad).toEqual({ ok: false, message: 'Google AI Studio answered 400: API key not valid (***)' });
});

it('when the AI service fails, the chat still answers and offers the form', async () => {
  await settings({ isOn: true, apiKey: 'sk-test-key' });
  useTransport(async () => { throw new Error('offline'); });
  const r = (await publicPost('/api/aia/chat', { message: 'Hello' })).json();
  expect(r.offerPerson).toBe(true);
  expect(r.reply).toContain('send your question to our staff');
});

it('is bounded: 20 messages per sender in 10 minutes, and 30 messages (15 exchanges) a chat', async () => {
  for (let i = 0; i < 20; i++) expect((await publicPost('/api/aia/chat', { message: `Question ${i}` })).statusCode).toBe(200);
  expect((await publicPost('/api/aia/chat', { message: 'One more' })).statusCode).toBe(429);
  // One chat from several senders: 15 questions and their answers fill it.
  const from = (n: number, chatId?: string) => env.app.inject({ method: 'POST', url: '/api/aia/chat', payload: { ...(chatId ? { chatId } : {}), message: 'More' }, remoteAddress: `198.51.100.${n}` });
  const chatId = (await from(1)).json().chatId as string;
  for (let n = 2; n <= 15; n++) expect((await from(n, chatId)).statusCode).toBe(200);
  expect((await from(16, chatId)).json().code).toBe('CHAT_FULL');
});
