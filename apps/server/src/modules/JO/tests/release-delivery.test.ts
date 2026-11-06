/**
 * A release sent out for delivery (the owner's request, Nov 2026): nobody has claimed it yet, so the slip leaves the receiver blank
 * to sign by hand, and the customer is not told someone picked it up. A ₱0 release needs no invoice. Made-up people only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { claimedMessage } from '../../COM/text.ts';
import { renderPrint } from '../../PRT/print.ts';
import { releaseDoc } from '../doctypes/release.ts';
import { awaitingInvoice } from '../doctypes/invoice-record.ts';
import { newReleasesAfter } from '../public.ts';
import { seedCustomers } from './cus-fixture.ts';

let env: TestEnv, encoder: Client, c: ReturnType<typeof seedCustomers>;
beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
});

async function readyOrder(unitPriceCents: number) {
  const input = { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: unitPriceCents ? 'full' : 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 2, unitPriceCents, discountCents: 0, roster: [] }] };
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: 2 * unitPriceCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) expect((await encoder.post(`/api/jo/orders/${r.json().id}/stage`, { from, to })).statusCode).toBe(200);
  return r.json().id as string;
}
const forDelivery = (jobOrderId: string) => ({ jobOrderId, lines: [{ lineNo: 1, qty: 2 }], claimedBy: 'For delivery', idSeen: 'none', forDelivery: true });
const record = async (release: object, expectedTotalCents: number, invoice: object | null = null) => {
  const r = await encoder.post('/api/jo/releases', { release, invoice, expectedTotalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().release as { id: string; number: string };
};
const slip = (id: string) => {
  const doc = releaseDoc.load(env.db, id);
  const head = env.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Record<string, unknown>;
  const header = { id, docType: 'jo.release', doc_type: 'jo.release', number: head.number, businessDate: head.business_date, business_date: head.business_date, status: 'posted' };
  return renderPrint(env.db, header as never, doc, { name: 'Sample Shop' } as never, 'document', 'Example Owner', '2026-09-28T10:00:00+08:00', 1, false, false, 'http://192.168.1.20:8080/');
};

describe('a release for delivery', () => {
  it('needs no receiver, says so, and keeps it when read back', async () => {
    const jo = await readyOrder(0);
    const rel = await record(forDelivery(jo), 0);
    const doc = releaseDoc.load(env.db, rel.id);
    expect(doc).toMatchObject({ forDelivery: true, claimedBy: 'For delivery', idSeen: 'none' });
    expect(releaseDoc.toInput(doc)).toMatchObject({ forDelivery: true });
    expect(releaseDoc.summary!(doc, {} as never)).toContain('for delivery.');
    expect(releaseDoc.summary!(doc, {} as never)).not.toContain('seen');
  });

  it('prints with the receiver left blank to sign and date, and no ID', async () => {
    const html = slip((await record(forDelivery(await readyOrder(0)), 0)).id);
    expect(html).toContain('Received by (name and signature)');
    expect(html).toContain('Date received');
    expect(html).toContain('For delivery');
    expect(html).not.toContain('ID type seen');
  });

  it('prints an ordinary release as before', async () => {
    const html = slip((await record({ jobOrderId: await readyOrder(0), lines: [{ lineNo: 1, qty: 2 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id' }, 0)).id);
    expect(html).toContain('Coach Placeholder');
    expect(html).toContain('ID type seen');
    expect(html).not.toContain('Date received');
  });

  it('tells the customer it is on its way, not that someone picked it up', async () => {
    const rel = await record(forDelivery(await readyOrder(0)), 0);
    const found = newReleasesAfter(env.db, 0, 50).items.find((r) => r.id === rel.id)!;
    expect(found.forDelivery).toBe(1);
    const lines = [{ description: 'Team jersey set', qty: 2 }];
    const p = { customerName: 'Sample Buyer', jobOrderNumber: 'JO-000001', releaseNumber: rel.number, date: '2026-09-28', claimedBy: found.claimedBy, balanceDueCents: 0, lines };
    const sent = claimedMessage('Sample Shop', { ...p, forDelivery: true });
    expect(sent.subject).toContain('is out for delivery');
    expect(sent.body).toContain('went out for delivery');
    expect(sent.subject + sent.body).not.toContain('picked up');
    expect(claimedMessage('Sample Shop', p).subject).toContain('has been picked up');
  });
});

describe('a release with nothing to charge', () => {
  it('records without an invoice and is not left waiting for one', async () => {
    const jo = await readyOrder(0);
    const rel = await record({ jobOrderId: jo, lines: [{ lineNo: 1, qty: 2 }], claimedBy: 'Coach Placeholder', idSeen: 'none' }, 0);
    expect(awaitingInvoice(env.db, jo).map((r) => r.id)).not.toContain(rel.id);
  });
});
