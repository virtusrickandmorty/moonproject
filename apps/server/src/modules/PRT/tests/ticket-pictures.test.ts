/** The job ticket shows the pictures attached to its job order (the design), inlined; not a PDF, not a removed one. */
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { smallPng } from '../../../../test/pictures.ts';
import { attachmentsDir } from '../../../engine/attachments.ts';
import { attachedPictures, renderPrint, type Profile } from '../print.ts';

let env: TestEnv;
let accountant: Client;
const profile: Profile = { registered_name: 'Example Garments Corp.', trade_name: 'Example Garments', tin: '000-111-222',
  registered_address: '1 Sample Street, Manila', is_vat_registered: 1, version: 1 };

beforeEach(async () => { env = await createTestEnv(); accountant = await env.as('accountant'); });
afterEach(async () => { const dir = attachmentsDir(env.db); await env.app.close(); env.db.close(); rmSync(dir, { recursive: true, force: true }); });

/** Any recorded document takes attachments; a journal voucher is the simplest to record. */
async function documentWith(files: [string, Buffer][]) {
  const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
  const r = await accountant.post('/api/docs/acc.jv/post', { input: { memo: 'Sample entry for pictures',
    lines: [{ accountId: account('1101'), debitCents: 1000 }, { accountId: account('3900'), creditCents: 1000 }] }, expectedTotalCents: 1000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  const id = r.json().id as string;
  const added = [];
  for (const [name, data] of files) {
    const a = await accountant.post(`/api/docs/acc.jv/${id}/attachments`, data, { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) });
    expect(a.statusCode, a.body).toBe(200);
    added.push(a.json().id as string);
  }
  return { id, added };
}

it('puts the attached pictures on the job ticket, inlined, without PDFs or removed pictures', async () => {
  const design = smallPng();
  const { id, added } = await documentWith([['front design.png', design], ['order form.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(64)])], ['old mock-up.png', smallPng()]]);
  await accountant.post(`/api/docs/acc.jv/${id}/attachments/${added[2]}/remove`, { reason: 'Replaced by the final design' });

  const pictures = attachedPictures(env.db, id);
  expect(pictures).toContain('<h2 class="section">Design</h2>');
  expect(pictures).toContain(`src="data:image/png;base64,${design.toString('base64')}"`);
  expect(pictures).toContain('front design.png');
  expect(pictures).not.toContain('order form.pdf');
  expect(pictures).not.toContain('old mock-up.png');

  const ticket = renderPrint(env.db, { id, number: 'JO-000001', business_date: '2026-09-28', doc_type: 'jo.job_order', status: 'posted' },
    { customerName: 'Sample Buyer', dueDate: '2026-10-13', priority: 'normal', lines: [] }, profile, 'job_ticket', 'Example Owner', '2026-09-28T10:00:00+08:00', 1);
  expect(ticket).toContain(pictures);
});

it('prints no Design section for a job order without pictures', async () => {
  const { id } = await documentWith([]);
  expect(attachedPictures(env.db, id)).toBe('');
});
