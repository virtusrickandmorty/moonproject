import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { smallJpeg } from '../../../../test/pictures.ts';
import { PER_SENDER_PER_HOUR } from '../routes.ts';

/** A small complete PNG. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const message = (extra: Record<string, unknown> = {}) => ({
  kind: 'quotation', name: 'Sample Eagles', email: 'eagles@example.com', phone: '0917 000 0000', subject: '20 jerseys',
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
    // Name, email and mobile number are all required.
    expect((await send(message({ name: ' ' }))).statusCode).toBe(400);
    for (const email of ['', 'eagles', 'eagles@example']) expect((await send(message({ email }))).json().code).toBe('EMAIL_REQUIRED');
    for (const phone of ['', '12345', 'call me', '0917 123 4567 0917 123 4567']) expect((await send(message({ phone }))).json().code).toBe('PHONE_REQUIRED');
    expect((await send(message({ phone: undefined }))).statusCode).toBe(400);
    expect((await send(message({ files: [{ name: 'virus.png', data: Buffer.from('MZ not a picture').toString('base64') }] }))).statusCode).toBe(415);
    expect((await send(message({ website: 'http://spam.example' }))).statusCode).toBe(400);
    expect((await send(message({ kind: 'refund' }))).statusCode).toBe(400);
    expect((await send(message({ files: Array(6).fill({ name: 'a.png', data: PNG }) }))).statusCode).toBe(400);
    expect(env.db.prepare('SELECT COUNT(*) AS n FROM sup_messages').get()).toEqual({ n: 0 });
  });

  it('refuses a truncated JPEG and accepts a small PNG', async () => {
    const jpeg = smallJpeg().subarray(0, -2);
    const truncated = await send(message({ files: [{ name: 'design.jpg', data: jpeg.toString('base64') }] }));
    expect(truncated.statusCode).toBe(415);
    expect(env.db.prepare('SELECT COUNT(*) AS n FROM sup_messages').get()).toEqual({ n: 0 });
    expect((await send(message())).statusCode).toBe(200);
  });

  it('refuses PNG dimensions over the side or total pixel limits', async () => {
    for (const [width, height] of [[6001, 1], [5000, 5000]]) {
      const png = Buffer.from(PNG, 'base64');
      png.writeUInt32BE(width!, 16); png.writeUInt32BE(height!, 20);
      const res = await send(message({ files: [{ name: 'design.png', data: png.toString('base64') }] }));
      expect(res.statusCode).toBe(415);
    }
    expect(env.db.prepare('SELECT COUNT(*) AS n FROM sup_messages').get()).toEqual({ n: 0 });
  });

  it('keeps the open-picture budget at 200 MB, accepts text when full, and releases budget when closed', async () => {
    await send(message({ files: [] }));
    const encoder = await env.as('encoder');
    const id = ((await encoder.get('/api/sup/messages')).json() as { rows: { id: string }[] }).rows[0]!.id;
    const cap = 200 * 1024 * 1024;
    const size = Buffer.from(PNG, 'base64').length;
    // Seed stored-byte accounting near the cap without allocating 200 MB of fixture blobs.
    const insert = env.db.prepare(`INSERT INTO sup_files (id, message_id, file_name, content_type, bytes, sha256, data)
      VALUES (?, ?, 'fixture.png', 'image/png', ?, 'fixture', X'00')`);
    for (let i = 0; i < 50; i++) insert.run(`budget-${i}`, id, 4 * 1024 * 1024 - (i === 0 ? size : 0));
    expect((await send(message())).statusCode).toBe(200); // exactly at the cap
    const refused = await send(message({ message: 'Please answer this text even if pictures cannot fit.' }));
    expect(refused.statusCode).toBe(200);
    expect(refused.json()).toMatchObject({ number: 'SUP-000003', pictureWarning: expect.stringContaining('Your message was saved') });
    const rows = ((await encoder.get('/api/sup/messages')).json() as { rows: { number: string; id: string; files: number; pictureBytes: number; message: string }[] }).rows;
    expect(rows.find((r) => r.number === 'SUP-000003')).toMatchObject({ files: 0, pictureBytes: 0, message: 'Please answer this text even if pictures cannot fit.' });
    expect(rows.find((r) => r.id === id)?.pictureBytes).toBe(cap - size);
    await encoder.post(`/api/sup/messages/${id}/notes`, { status: 'closed', note: '', version: 1 });
    expect((await send(message())).json()).toEqual({ number: 'SUP-000004' });
    expect((await encoder.post(`/api/sup/messages/${id}/notes`, { status: 'in_progress', note: '', version: 2 })).statusCode).toBe(409);
  });

  it('limits how many messages one sender can send in an hour', async () => {
    for (let i = 0; i < PER_SENDER_PER_HOUR; i++) expect((await send(message())).statusCode).toBe(200);
    expect((await send(message())).statusCode).toBe(429);
    expect((await send(message(), '10.0.0.6')).statusCode).toBe(200);
  });

  it('notifies the staff who read the inbox until someone starts on the message', async () => {
    await send(message({ kind: 'complaint', subject: 'Torn seam', files: [] }));
    const encoder = await env.as('encoder');
    const notes = async (c: typeof encoder) => ((await c.get('/api/dash/notifications')).json() as { kind: string; label: string; href: string }[]).filter((n) => n.kind === 'support-message');
    const id = ((await encoder.get('/api/sup/messages')).json() as { rows: { id: string }[] }).rows[0]!.id;
    expect(await notes(encoder)).toEqual([expect.objectContaining({ label: 'Complaint from Sample Eagles: Torn seam', href: `/sup?open=${id}` })]);
    expect(await notes(await env.as('production'))).toEqual([]);
    await encoder.post(`/api/sup/messages/${id}/notes`, { status: 'in_progress', note: '', version: 1 });
    expect(await notes(encoder)).toEqual([]);
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

describe('mobile numbers the support form takes', () => {
  it('takes the usual ways of writing a number', async () => {
    const { PHONE } = await import('../routes.ts');
    for (const ok of ['09171234567', '0917 123 4567', '0917-123-4567', '+63 917 123 4567', '(02) 8123 4567']) expect(PHONE.test(ok), ok).toBe(true);
  });
});
