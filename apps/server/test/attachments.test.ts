/**
 * Attachments on documents (engine/attachments.ts): add and list; the same file twice is stored once; only JPEG, PNG,
 * WebP and PDF up to 10 MB, checked for completeness and dimensions; opening needs a session (N-13: 401) and the view permission
 * (403); removing keeps the row, the file and the audit; posted and cancelled documents both take them, with no journal.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from './helpers.ts';
import { smallPng as PNG, smallJpeg as JPEG, smallWebp as WEBP } from './pictures.ts';
import { attachmentsDir, sniffType } from '../src/engine/attachments.ts';
import { verifyAuditChain } from '../src/engine/audit.ts';
import { runInvariants } from '../src/engine/ledger/invariants.ts';

let env: TestEnv;
let accountant: Client, encoder: Client;

const PDF = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(64)]);

const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const jv = async (memo = 'Accrued rent for the month') => {
  const r = await accountant.post('/api/docs/acc.jv/post', {
    input: { memo, lines: [{ accountId: account('1101'), debitCents: 1000 }, { accountId: account('3900'), creditCents: 1000 }] },
    expectedTotalCents: 1000,
  }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
};
const base = (id: string, type = 'acc.jv') => `/api/docs/${type}/${id}/attachments`;
const add = (c: Client, id: string, data: Buffer, name: string, type = 'acc.jv') =>
  c.post(base(id, type), data, { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) });
const stored = () => readdirSync(attachmentsDir(env.db)).filter((f) => !f.endsWith('.tmp'));
const audits = (action: string) =>
  (env.db.prepare('SELECT entity_type, entity_id, data FROM audit_log WHERE action = ? ORDER BY seq').all(action) as { entity_type: string; entity_id: string; data: string }[])
    .map((r) => ({ ...r, data: JSON.parse(r.data) as Record<string, unknown> }));

beforeEach(async () => {
  env = await createTestEnv();
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
});
afterEach(async () => {
  const dir = attachmentsDir(env.db);
  await env.app.close();
  env.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('attachments', () => {
  it('recognises complete pictures and PDF files', () => {
    expect([PNG(), JPEG(), PDF(), WEBP()].map(sniffType)).toEqual(['image/png', 'image/jpeg', 'application/pdf', 'image/webp']);
    expect(sniffType(Buffer.from('MZ\x90\x00 this program cannot be run in DOS mode'))).toBeNull();
    expect(sniffType(Buffer.from('GIF89a......'))).toBeNull();
  });

  it('adds a file to a posted document and lists it with who and when; the audit has name, size and SHA-256, never the contents', async () => {
    const id = await jv();
    const data = PNG();
    const res = await add(accountant, id, data, 'Lease – page 1.png');
    expect(res.statusCode, res.body).toBe(200);
    const row = res.json();
    expect(row).toMatchObject({ fileName: 'Lease – page 1.png', contentType: 'image/png', bytes: data.length, removedAt: null, addedAt: expect.stringMatching(/^2026-09-28T10:00/) });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    const list = await accountant.get(base(id));
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([row]);
    expect(row.addedByName).toMatch(/^accountant-/);
    expect(stored()).toEqual([row.sha256]);
    const [a] = audits('attachment.add');
    expect(a).toMatchObject({ entity_type: 'acc.jv', entity_id: id, data: { fileName: 'Lease – page 1.png', bytes: data.length, sha256: row.sha256, contentType: 'image/png' } });
    expect(JSON.stringify(a)).not.toContain(data.toString('base64'));
    // Folders in the name are dropped.
    expect((await add(accountant, id, JPEG(), 'C:\\Users\\clerk\\receipt.JPG')).json().fileName).toBe('receipt.JPG');
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('stores the same file once, however many documents have it; the same document refuses it twice', async () => {
    const [one, two] = [await jv(), await jv('Accrued power bill')];
    const data = PDF();
    expect((await add(accountant, one, data, 'bill.pdf')).statusCode).toBe(200);
    expect((await add(accountant, two, data, 'same bill.pdf')).statusCode).toBe(200);
    expect(stored()).toHaveLength(1);
    const again = await add(accountant, one, data, 'bill again.pdf');
    expect([again.statusCode, again.json().code]).toEqual([409, 'ALREADY_ATTACHED']);
    expect(env.db.prepare('SELECT COUNT(*) FROM attachments').pluck().get()).toBe(2);
  });

  it('refuses a wrong type, a renamed .exe, a file over 10 MB and an empty one, and keeps nothing', async () => {
    const id = await jv();
    const refused = [
      [Buffer.from('GIF89a......'), 'spinner.gif', 415, 'FILE_TYPE'],
      [Buffer.from('Just some notes'), 'notes.pdf', 415, 'FILE_TYPE'],
      [Buffer.from('MZ\x90\x00\x03\x00\x00\x00 This program cannot be run in DOS mode.'), 'photo.jpg', 415, 'FILE_TYPE'],
      [PNG(), 'picture.exe', 415, 'FILE_TYPE'],
      [Buffer.concat([JPEG(), Buffer.alloc(10 * 1024 * 1024)]), 'huge.jpg', 413, 'FILE_TOO_BIG'],
      [Buffer.alloc(0), 'empty.png', 400, 'EMPTY_FILE'],
    ] as const;
    for (const [data, name, status, code] of refused) {
      const r = await add(accountant, id, data as Buffer, name);
      expect([name, r.statusCode, r.json().code]).toEqual([name, status, code]);
    }
    expect(env.db.prepare('SELECT COUNT(*) FROM attachments').pluck().get()).toBe(0);
    expect(stored()).toEqual([]);
    expect(audits('attachment.add')).toEqual([]);
  });

  it('opens a file only with a session (401) and the view permission (403), with its checked type and a sandbox', async () => {
    const id = await jv();
    const data = JPEG();
    const att = (await add(accountant, id, data, 'receipt.jpg')).json();
    const url = `${base(id)}/${att.id}`;
    const anonymous = await env.app.inject({ method: 'GET', url });
    expect([anonymous.statusCode, anonymous.json().code]).toEqual([401, 'AUTH_REQUIRED']);
    expect((await env.app.inject({ method: 'GET', url: base(id) })).statusCode).toBe(401);
    // The encoder may not see journal vouchers.
    expect((await encoder.get(url)).statusCode).toBe(403);
    expect((await encoder.get(base(id))).statusCode).toBe(403);
    expect((await add(encoder, id, PNG(), 'x.png')).statusCode).toBe(403);
    const open = await accountant.get(url);
    expect(open.statusCode).toBe(200);
    expect(open.rawPayload.equals(data)).toBe(true);
    expect(open.headers['content-type']).toBe('image/jpeg');
    expect(open.headers['x-content-type-options']).toBe('nosniff');
    expect(open.headers['content-security-policy']).toMatch(/^sandbox; default-src 'none'/);
    expect(open.headers['content-disposition']).toBe(`inline; filename="receipt.jpg"; filename*=UTF-8''receipt.jpg`);
    // Another document's id does not open it.
    const other = await jv('Accrued water bill');
    expect((await accountant.get(`${base(other)}/${att.id}`)).statusCode).toBe(404);
    // The ordinary pages keep their own policy.
    expect((await accountant.get(base(id))).headers['content-security-policy']).toBe("frame-ancestors 'none'");
  });

  it('removes with a reason: the row, the file and the audit stay, and it can still be opened', async () => {
    const id = await jv();
    const att = (await add(accountant, id, PNG(), 'wrong page.png')).json();
    const remove = (reason: string) => accountant.post(`${base(id)}/${att.id}/remove`, { reason });
    expect((await remove('oops')).json().code).toBe('REASON_REQUIRED');
    expect((await encoder.post(`${base(id)}/${att.id}/remove`, { reason: 'Attached to the wrong voucher' })).statusCode).toBe(403);
    const res = await remove('Attached to the wrong voucher');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id: att.id, removedReason: 'Attached to the wrong voucher', removedAt: expect.stringMatching(/^2026-09-28/), removedByName: expect.stringMatching(/^accountant-/) });
    expect((await accountant.get(base(id))).json()).toMatchObject([{ id: att.id, removedReason: 'Attached to the wrong voucher' }]);
    expect(stored()).toEqual([att.sha256]);
    expect((await accountant.get(`${base(id)}/${att.id}`)).statusCode).toBe(200);
    expect((await remove('Attached to the wrong voucher')).json().code).toBe('ALREADY_REMOVED');
    expect(audits('attachment.remove')).toMatchObject([{ entity_id: id, data: { fileName: 'wrong page.png', sha256: att.sha256, reason: 'Attached to the wrong voucher' } }]);
    // The row is never deleted, and only its removal is ever written.
    expect(() => env.db.prepare('DELETE FROM attachments').run()).toThrow(/NO_DELETE/);
    expect(() => env.db.prepare(`UPDATE attachments SET file_name = 'x.png'`).run()).toThrow(/IMMUTABLE/);
    // Once removed, the same file may be attached again.
    expect((await add(accountant, id, readFileSync(join(attachmentsDir(env.db), att.sha256)), 'right page.png')).statusCode).toBe(200);
  });

  it('works on a cancelled document and never touches a journal', async () => {
    const id = await jv();
    expect((await accountant.post(`/api/docs/acc.jv/${id}/cancel`, { reason: 'Entered twice by mistake' }, idem())).statusCode).toBe(200);
    const journals = env.db.prepare('SELECT COUNT(*) FROM journal_lines').pluck().get();
    expect((await add(accountant, id, PDF(), 'support.pdf')).statusCode).toBe(200);
    expect(env.db.prepare('SELECT COUNT(*) FROM journal_lines').pluck().get()).toBe(journals);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('takes at most 10 files on a document', async () => {
    const id = await jv();
    for (let i = 0; i < 10; i++) expect((await add(accountant, id, PDF(), `page ${i}.pdf`)).statusCode).toBe(200);
    const eleventh = await add(accountant, id, PDF(), 'page 11.pdf');
    expect([eleventh.statusCode, eleventh.json().code]).toEqual([409, 'TOO_MANY']);
  });

  it('takes at most 5 pictures on a quotation', async () => {
    const owner = await env.as('owner');
    const item = await owner.post('/api/cat/items', { code: 'FAKE-JERSEY', name: 'Sample jersey', class: 'service', garmentType: null, unit: 'pc', setComponents: 1 });
    expect(item.statusCode, item.body).toBe(200);
    const itemId = item.json().id as string;
    expect((await owner.post(`/api/cat/items/${itemId}/prices`, { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: 50_000 }, { 'if-match': '1' })).statusCode).toBe(200);
    const quote = await encoder.post('/api/docs/quo.quotation/post', {
      input: { prospectName: 'Fictional Club', lines: [{ itemId, description: 'Sample jersey', qty: 1, unit: 'pc' }] },
      expectedTotalCents: 50_000,
    }, idem());
    expect(quote.statusCode, quote.body).toBe(200);
    const id = quote.json().id as string;
    for (let i = 0; i < 5; i++) expect((await add(encoder, id, PNG(), `mock-up ${i}.png`, 'quo.quotation')).statusCode).toBe(200);
    const sixth = await add(encoder, id, WEBP(), 'mock-up 6.webp', 'quo.quotation');
    expect([sixth.statusCode, sixth.json().code]).toEqual([409, 'TOO_MANY_IMAGES']);
    expect((await add(encoder, id, PDF(), 'size chart.pdf', 'quo.quotation')).statusCode).toBe(200);
  });
});

