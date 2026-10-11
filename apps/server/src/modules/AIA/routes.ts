/**
 * The assistant's routes (the owner's request, Oct 2026). Public, for the website's chat: whether it is on (and its
 * greeting), one customer message at a time, and the handoff to the Support inbox. Staff: the settings (owner) and the
 * chats, to read what customers asked. The public routes take no session, so they are bounded by size and per sender,
 * and a chat is at most 30 messages; when the assistant is off, has no key or the internet is down, the chat says so and
 * the handoff form still files the message.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, newId, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requestRateLimiter } from '../../engine/security/sessions.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { SUPPORT_EMAIL, SUPPORT_PHONE, recordSupportMessage } from '../SUP/public.ts';
import { answer, systemPrompt, testKey, type ModelTurn } from './agent.ts';
import { aiaSettings, readApiKey, saveAiaSettings } from './settings.ts';

export const MAX_CHAT_MESSAGES = 30;
const HISTORY = 16; // the last turns sent with each question
const OFFLINE = 'Sorry, I cannot answer right now. Please send your question to our staff with the form below, and we will reply by phone or email.';

const chatInput = z.object({ chatId: z.uuid().optional(), message: z.string().trim().min(1).max(800) }).strict();
const handoffInput = z.object({
  chatId: z.uuid(), name: z.string().trim().min(1).max(100), email: z.string().trim().max(200), phone: z.string().trim().max(40),
  note: z.string().trim().max(1000).optional(), consent: z.literal(true),
}).strict();

export function aiaRoutes(app: FastifyInstance, { db, clock }: AppDeps): void {
  // Per sender: 20 messages and 3 handoffs per 10 minutes; at most 2,000 addresses remembered.
  const perSender = requestRateLimiter(clock, 20, 10 * 60_000, 2000);
  const handoffs = requestRateLimiter(clock, 3, 10 * 60_000, 2000);
  const transcript = (chatId: string) => db.prepare('SELECT seq, role, text, at FROM aia_messages WHERE chat_id = ? ORDER BY seq').all(chatId) as { seq: number; role: 'customer' | 'assistant'; text: string; at: string }[];

  /** For the website: is the chat on, and its first words. */
  app.get('/api/aia/public', { config: { permission: 'public' } }, async () => {
    const s = aiaSettings(db);
    return { on: s.isOn && s.keySet, greeting: s.greeting };
  });

  app.post('/api/aia/chat', { bodyLimit: 4 * 1024, config: { permission: 'public' } }, async (req) => {
    perSender(req.ip);
    const b = chatInput.parse(req.body);
    const s = aiaSettings(db);
    const at = stamp(clock);
    const now = clock.now().getTime();
    // The chat and the customer's words are kept first, so a failed answer still leaves them for the handoff.
    const { chatId, seq } = tx(db, () => {
      let id = b.chatId;
      if (id && !db.prepare('SELECT 1 FROM aia_chats WHERE id = ?').get(id)) throw notFound('The chat');
      if (!id) {
        id = newId();
        db.prepare('INSERT INTO aia_chats (id, started_at, started_ms, ip) VALUES (?, ?, ?, ?)').run(id, at, now, req.ip);
      }
      const n = (db.prepare('SELECT COUNT(*) AS n FROM aia_messages WHERE chat_id = ?').get(id) as { n: number }).n;
      if (n >= MAX_CHAT_MESSAGES) throw new AppError('CHAT_FULL', 'This chat is long enough. Please send it to our staff with the form below.', 429);
      db.prepare('INSERT INTO aia_messages (chat_id, seq, role, text, at, at_ms) VALUES (?, ?, ?, ?, ?, ?)').run(id, n + 1, 'customer', b.message, at, now);
      return { chatId: id, seq: n + 2 };
    });
    const key = readApiKey(db);
    let reply = { text: OFFLINE, handoff: true, inputTokens: 0, outputTokens: 0 };
    if (s.isOn && key) {
      const history: ModelTurn[] = transcript(chatId).slice(-HISTORY).map((m) => ({ role: m.role === 'customer' ? 'user' : 'model', parts: [{ text: m.text }] }));
      while (history.length && history[0]!.role !== 'user') history.shift();
      try {
        reply = await answer({ db, app, today: today(clock), ip: req.ip, apiKey: key, system: systemPrompt(db, s.knowledge, today(clock)), history });
      } catch (e) {
        req.log.warn({ err: (e as Error).message }, 'aia: the AI service did not answer'); // never the key or the customer's words
      }
    }
    const done = stamp(clock);
    db.prepare('INSERT INTO aia_messages (chat_id, seq, role, text, at, at_ms, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(chatId, seq, 'assistant', reply.text, done, clock.now().getTime(), reply.inputTokens, reply.outputTokens);
    return { chatId, reply: reply.text, offerPerson: reply.handoff };
  });

  /** The chat goes to the Support inbox as an inquiry, with the whole conversation, and the customer's contact details. */
  app.post('/api/aia/handoff', { bodyLimit: 4 * 1024, config: { permission: 'public' } }, async (req) => {
    handoffs(req.ip);
    const b = handoffInput.parse(req.body);
    if (!SUPPORT_EMAIL.test(b.email)) throw new AppError('EMAIL_REQUIRED', 'Please give a valid email address so we can answer you.', 400);
    if (!SUPPORT_PHONE.test(b.phone)) throw new AppError('PHONE_REQUIRED', 'Please give your mobile number, like 0917 123 4567.', 400);
    const at = stamp(clock);
    return tx(db, () => {
      if (!db.prepare('SELECT 1 FROM aia_chats WHERE id = ?').get(b.chatId)) throw notFound('The chat');
      const done = db.prepare('SELECT sup_number AS number FROM aia_handoffs WHERE chat_id = ?').get(b.chatId) as { number: string } | undefined;
      if (done) return { number: done.number };
      const lines = transcript(b.chatId).map((m) => `${m.role === 'customer' ? 'Customer' : 'Assistant'}: ${m.text}`);
      const message = [b.note ? `Note from the customer: ${b.note}` : '', 'Chat with the website assistant:', ...lines].filter(Boolean).join('\n').slice(0, 5000);
      const sup = recordSupportMessage(db, { kind: 'inquiry', name: b.name, email: b.email, phone: b.phone, subject: 'From the website chat', message, orderRef: null }, req.ip, at, clock.now().getTime());
      db.prepare('INSERT INTO aia_handoffs (chat_id, sup_message_id, sup_number, at) VALUES (?, ?, ?, ?)').run(b.chatId, sup.id, sup.number, at);
      return { number: sup.number };
    });
  });

  app.get('/api/aia/settings', { config: { permission: 'aia.manage' } }, async () => aiaSettings(db));
  /** The owner's "Test the key": one short question to Google AI Studio with the saved key. */
  app.post('/api/aia/test', { config: { permission: 'aia.manage' } }, async () => {
    const key = readApiKey(db);
    if (!key) return { ok: false, message: 'No key is saved yet.' };
    return testKey(key);
  });
  app.put('/api/aia/settings', { config: { permission: 'aia.manage' } }, async (req) =>
    tx(db, () => saveAiaSettings(db, req.body, { userId: currentUser(req).userId, at: stamp(clock) })));

  /** The latest chats (100), newest first, with how many messages, whether staff got them, and the tokens they took. */
  app.get('/api/aia/chats', { config: { permission: 'aia.view' } }, async () => {
    const rows = db.prepare(`SELECT c.id, c.started_at AS startedAt,
        (SELECT COUNT(*) FROM aia_messages m WHERE m.chat_id = c.id) AS messages,
        (SELECT text FROM aia_messages m WHERE m.chat_id = c.id AND m.seq = 1) AS firstQuestion,
        (SELECT COALESCE(SUM(input_tokens), 0) FROM aia_messages m WHERE m.chat_id = c.id) AS inputTokens,
        (SELECT COALESCE(SUM(output_tokens), 0) FROM aia_messages m WHERE m.chat_id = c.id) AS outputTokens,
        h.sup_number AS supportNumber
      FROM aia_chats c LEFT JOIN aia_handoffs h ON h.chat_id = c.id ORDER BY c.started_ms DESC LIMIT 100`).all();
    const month = clock.now().getTime() - 30 * 86_400_000;
    const usage = db.prepare('SELECT COUNT(DISTINCT chat_id) AS chats, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens FROM aia_messages WHERE at_ms >= ?').get(month);
    return { rows, last30Days: usage };
  });
  app.get<{ Params: { id: string } }>('/api/aia/chats/:id', { config: { permission: 'aia.view' } }, async (req) => {
    if (!db.prepare('SELECT 1 FROM aia_chats WHERE id = ?').get(req.params.id)) throw notFound('The chat');
    const user = currentUser(req);
    appendAudit(db, { at: stamp(clock), userId: user.userId, action: 'aia.chat.read', entityType: 'aia_chats', entityId: req.params.id, data: {} });
    return { messages: transcript(req.params.id), supportNumber: (db.prepare('SELECT sup_number FROM aia_handoffs WHERE chat_id = ?').pluck().get(req.params.id) as string | undefined) ?? null };
  });
}
