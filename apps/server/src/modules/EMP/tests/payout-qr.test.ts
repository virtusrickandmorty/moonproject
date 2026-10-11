/** The employee's bank or GCash QR picture (the owner's request, Oct 2026). Made-up people and a made-up picture only. */
import { expect, test } from 'vitest';
import { createTestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';

// The smallest PNG: a 1×1 picture, standing in for a photo of a QR code.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('saves, shows and takes off the QR; only emp.manage changes it; the audit never carries the picture', async () => {
  const env = await createTestEnv(); encoderOwnDefaults(env);
  const [acct, enc] = [await env.as('accountant'), await env.as('encoder')];
  const e = (await acct.post('/api/emp/employees', { fullName: 'Ana Tahi', costCentre: 'production', hireDate: '2026-03-02' })).json() as { id: string };
  const url = `/api/emp/employees/${e.id}/payout-qr`;

  expect((await acct.get(`/api/emp/employees/${e.id}`)).json().payoutQr).toBeNull();
  expect((await acct.get(url)).statusCode).toBe(404);
  expect((await enc.put(url, { name: 'qr.png', data: PNG.toString('base64') })).statusCode).toBe(403);
  const notPicture = await acct.put(url, { name: 'qr.txt', data: Buffer.from('not a picture').toString('base64') });
  expect([notPicture.statusCode, notPicture.json().code]).toEqual([415, 'FILE_TYPE']);

  const saved = await acct.put(url, { name: 'gcash.png', data: PNG.toString('base64') });
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json().payoutQr).toMatchObject({ version: 1, contentType: 'image/png' });
  const pic = await enc.get(url); // whoever sees the employee sees the QR, to send the pay
  expect([pic.statusCode, pic.headers['content-type'], pic.headers['cache-control']]).toEqual([200, 'image/png', 'private, no-store']);
  expect(pic.rawPayload.equals(PNG)).toBe(true);
  expect((await enc.get('/api/emp/employees')).json().map((r: { hasPayoutQr: boolean }) => r.hasPayoutQr)).toEqual([true]);

  expect((await acct.post(`${url}/remove`, {})).json().payoutQr).toBeNull();
  expect((await acct.get(url)).statusCode).toBe(404);
  expect((await acct.get('/api/emp/employees')).json()[0].hasPayoutQr).toBe(false);
  expect((await acct.post(`${url}/remove`, {})).statusCode).toBe(409);

  // Every version stays; nothing is changed or deleted in place.
  expect(() => env.db.prepare('DELETE FROM emp_payout_qr').run()).toThrow(/IMMUTABLE/);
  const audit = env.db.prepare("SELECT action, data FROM audit_log WHERE action LIKE 'emp.payout_qr.%' ORDER BY seq").all() as { action: string; data: string }[];
  expect(audit.map((a) => a.action)).toEqual(['emp.payout_qr.save', 'emp.payout_qr.remove']);
  expect(audit.map((a) => a.data).join()).not.toContain(PNG.toString('base64').slice(0, 20));
}, 30_000);
