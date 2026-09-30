/** The customer email screens' words, the menu, and the web client against the real server with a fake mail transport. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { useTransport } from '../../../../server/src/modules/COM/transport.ts';
import { createApi } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { documentWords, KIND_WORDS, progressWords, TEMPLATE_WORDS } from './com.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('customer email screen words', () => {
  it('names each template and says where an email stands', () => {
    expect(Object.values(TEMPLATE_WORDS).join(' ')).not.toMatch(/invoice|official receipt/i);
    const base = { attempts: 0, nextAttemptAt: '2026-09-28T10:05:00.000+08:00', sentAt: null, lastError: null };
    expect(progressWords({ ...base, status: 'queued' })).toBe('Waiting to be sent');
    expect(progressWords({ ...base, status: 'queued', attempts: 2, lastError: 'Mailbox full' })).toBe('Try 2 failed (Mailbox full). Next try 2026-09-28 10:05');
    expect(progressWords({ ...base, status: 'failed', attempts: 5, lastError: 'Mailbox full' })).toBe('Failed after 5 tries: Mailbox full');
    expect(progressWords({ ...base, status: 'sent', attempts: 1, sentAt: '2026-09-28T10:00:00.000+08:00' })).toBe('Sent 2026-09-28 10:00');
  });

  it('a payslip email is named and shows the recipient and the pay period, never an amount', () => {
    expect(TEMPLATE_WORDS.payslip).toBe('Payslip');
    expect(KIND_WORDS).toEqual({ customer: 'Customer emails', payslip: 'Payslip emails' });
    expect(documentWords({ kind: 'payslip', documentNumber: 'POUT-000004', periodFrom: '2026-09-16', periodTo: '2026-09-30' })).toBe('Pay 2026-09-16 to 2026-09-30 (POUT-000004)');
    expect(documentWords({ kind: 'customer', documentNumber: null, periodFrom: '2026-09-01', periodTo: '2026-09-30' })).toBe('2026-09-01 to 2026-09-30');
    expect(documentWords({ kind: 'customer', documentNumber: 'JO-000001', periodFrom: null, periodTo: null })).toBe('JO-000001');
  });

  it('shows the outbox to those who may see it and the settings only to those who may change them', () => {
    const labels = (permissions: string[]) => buildMenu([], new Set(permissions)).flatMap((g) => g.items.map((i) => `${i.label} ${i.path}`)).filter((l) => /email/i.test(l));
    expect(labels([])).toEqual([]);
    expect(labels(['com.outbox.view'])).toEqual(['Customer emails /com']);
    expect(labels(['com.outbox.view', 'com.settings.manage'])).toEqual(['Customer emails /com', 'Customer email settings /com/settings']);
  });
});

describe('web client for the customer email screens', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'moonproject-com-web-'));
    process.env.MOONPROJECT_COM_DIR = dir;
  });
  afterEach(() => {
    useTransport(null);
    delete process.env.MOONPROJECT_COM_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('settings need a fresh password, the App Password never comes back, and a test email goes through the transport', async () => {
    const sent: string[] = [];
    useTransport({ online: async () => true, send: async (_c, m) => void sent.push(m.subject) });
    const env = await createTestEnv();
    createUser(env.db, 'own1', ['owner']);
    createUser(env.db, 'acct1', ['accountant']);
    const owner = createApi(injectFetch(env.app));
    const acct = createApi(injectFetch(env.app));
    await owner.login('own1', PASSWORD);
    await acct.login('acct1', PASSWORD);

    const before = await owner.comSettings();
    expect(before).toMatchObject({ sendingOn: false, appPasswordSet: false, version: 0 });
    const body = { sendingOn: true, host: 'smtp.example.test', port: 587, user: 'shop@example.test', senderName: 'Virtus Garments', senderAddress: 'shop@example.test', appPassword: 'abcd efgh ijkl mnop' };
    await expect(owner.comSaveSettings(0, body)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await owner.stepUp(PASSWORD);
    const saved = await owner.comSaveSettings(0, body);
    expect(saved).toMatchObject({ sendingOn: true, appPasswordSet: true, missing: [], version: 1 });
    expect(JSON.stringify(saved)).not.toContain('abcd');
    await expect(owner.comSaveSettings(0, body)).rejects.toMatchObject({ code: 'STALE' });
    await expect(owner.comTestEmail()).resolves.toMatchObject({ ok: true });
    expect(sent).toHaveLength(1);
    expect(await owner.comOutbox()).toEqual({ rows: [], counts: { queued: 0, sent: 0, failed: 0 } });
    expect(await acct.comOutbox()).toMatchObject({ rows: [] });
    await expect(acct.comSettings()).rejects.toMatchObject({ status: 403 });
    await expect(acct.comResend('x')).rejects.toMatchObject({ status: 403 });
    // The kind filter is sent to the server.
    expect(await owner.comOutbox(undefined, 'payslip')).toEqual({ rows: [], counts: { queued: 0, sent: 0, failed: 0 } });
    expect(await owner.comOutbox('failed', 'customer')).toMatchObject({ rows: [] });
  });
});
