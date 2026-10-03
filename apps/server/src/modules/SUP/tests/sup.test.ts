import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { PER_SENDER_PER_HOUR } from '../routes.ts';

/** A real 1×1 PNG, so the first-bytes check passes. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const message = (extra: Record<string, unknown> = {}) => ({
  kind: 'quotation', name: 'Sample Eagles', email: 'eagles@example.com', subject: '20 jerseys',
  message: 'Royal blue jerseys for our league, sizes M to XL.', consent: true, files: [{ name: 'design.png', data: PNG }], ...extra,
});

let env: TestEnv;
const send = (payload: object, ip = '10.0.0.5') => env.app.inject({ method: 'POST', url: '/api/sup/messages', payload, remoteAddress: ip });
beforeEach(async () => { env = await createTestEnv(); });

describe('customer support', () => {
  it('takes a quotation request with a picture without signing in, and staff read it', async () => {
    const res = await send(message());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ number: 'SUP-000001' });

    const encoder = await env.as('encoder');
    const list = (await encoder.get('/api/sup/messages?status=new')).json() as { rows: { id: string; files: number; kind: string }[]; counts: { new: number } };
    expect(list.counts.new).toBe(1);
    expect(list.rows[0]).toMatchObject({ kind: 'quotation', files: 1 });
    const detail = (await encoder.get(`/api/sup/messages/${list.rows[0]!.id}`)).json() as { attachments: { id: string; contentType: string }[]; version: number };
    expect(detail.attachments[0]!.contentType).toBe('image/png');
    const picture = await encoder.get(`/api/sup/messages/${list.rows[0]!.id}/files/${detail.attachments[0]!.id}`);
    expect(picture.statusCode).toBe(200);
    expect(picture.headers['content-type']).toBe('image/png');
    expect(picture.headers['content-security-policy']).toContain('sandbox');
    expect(Buffer.compare(picture.rawPayload, Buffer.from(PNG, 'base64'))).toBe(0);
  });

  it('refuses a message without consent, without a way to answer, with a fake picture, or filled in by a robot', async () => {
    expect((await send(message({ consent: false }))).statusCode).toBe(400);
    expect((await send(message({ email: '', phone: '' }))).json().code).toBe('CONTACT_REQUIRED');
    expect((await send(message({ files: [{ name: 'virus.png', data: Buffer.from('MZ not a picture').toString('base64') }] }))).statusCode).toBe(415);
    expect((await send(message({ website: 'http://spam.example' }))).statusCode).toBe(400);
    expect((await send(message({ kind: 'refund' }))).statusCode).toBe(400);
    expect((await send(message({ files: Array(6).fill({ name: 'a.png', data: PNG }) }))).statusCode).toBe(400);
    expect(env.db.prepare('SELECT COUNT(*) AS n FROM sup_messages').get()).toEqual({ n: 0 });
  });

  it('limits how many messages one sender can send in an hour', async () => {
    for (let i = 0; i < PER_SENDER_PER_HOUR; i++) expect((await send(message())).statusCode).toBe(200);
    expect((await send(message())).statusCode).toBe(429);
    expect((await send(message(), '10.0.0.6')).statusCode).toBe(200);
  });

  it('lets only permitted staff read and answer, and refuses a stale answer', async () => {
    await send(message({ kind: 'complaint', orderRef: 'JO-000123', files: [] }));
    expect((await env.app.inject({ method: 'GET', url: '/api/sup/messages' })).statusCode).toBe(401);
    expect((await (await env.as('production')).get('/api/sup/messages')).statusCode).toBe(403);
    const encoder = await env.as('encoder');
    const id = ((await encoder.get('/api/sup/messages')).json() as { rows: { id: string }[] }).rows[0]!.id;
    const answered = await encoder.post(`/api/sup/messages/${id}/notes`, { status: 'in_progress', note: 'Called the customer back.', version: 1 });
    expect(answered.statusCode, answered.body).toBe(200);
    expect(answered.json()).toMatchObject({ status: 'in_progress', version: 2, orderRef: 'JO-000123' });
    expect((await encoder.post(`/api/sup/messages/${id}/notes`, { status: 'closed', note: '', version: 1 })).statusCode).toBe(409);
    expect((await (await env.as('accountant')).post(`/api/sup/messages/${id}/notes`, { status: 'closed', note: 'x', version: 2 })).statusCode).toBe(403);
    const notes = ((await encoder.get(`/api/sup/messages/${id}`)).json() as { notes: { note: string }[] }).notes;
    expect(notes.map((n) => n.note)).toEqual(['Called the customer back.']);
  });
});
