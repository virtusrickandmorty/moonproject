/**
 * Receiving report (PLAN D5 RCV: "Quantities only (periodic)"): it posts no journal, and its cancel posts no reversal.
 * (Posting coverage check, docs/review/posting-coverage.md.)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
});

const journalCount = (documentId: string) => env.db.prepare(`SELECT COUNT(*) FROM journals WHERE source_type = 'document' AND source_id = ?`).pluck().get(documentId) as number;
const allLines = () => env.db.prepare('SELECT COUNT(*) FROM journal_lines').pluck().get() as number;

describe('receiving report posts nothing (D5 RCV)', () => {
  it('a PO and a receipt of 5 of its 10 yards: no journal; the cancel: no reversal', async () => {
    const supplierId = (await accountant.post('/api/pur/suppliers', { name: 'Sample Fabric Trading', registeredName: 'Sample Fabric Trading Inc.', isVatRegistered: false })).json().id as string;
    const supplyId = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id as string;
    const po = await encoder.post('/api/docs/pur.po/post', { input: { supplierId, expectedDate: '2026-10-15', lines: [{ supplyId, qty: 10, unitCostCents: 15_000 }] }, expectedTotalCents: 150_000 }, idem());
    expect(po.statusCode, po.body).toBe(200);
    const poLineNo = (await encoder.get(`/api/docs/pur.po/${po.json().id}`)).json().doc.lines[0].lineNo;

    const rr = await encoder.post('/api/docs/pur.rr/post', { input: { poDocumentId: po.json().id, lines: [{ poLineNo, qty: 5 }] }, expectedTotalCents: 0 }, idem());
    expect(rr.statusCode, rr.body).toBe(200);
    expect(rr.json().journalNumber ?? null).toBeNull();
    expect(journalCount(rr.json().id)).toBe(0);
    expect(allLines()).toBe(0);

    expect((await accountant.post(`/api/docs/pur.rr/${rr.json().id}/cancel`, { reason: 'Wrong quantity was recorded' }, idem())).statusCode).toBe(200);
    expect(journalCount(rr.json().id)).toBe(0);
    expect(allLines()).toBe(0);
    expect((await encoder.get(`/api/docs/pur.rr/${rr.json().id}`)).json().header.status).toBe('cancelled');
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});
