/**
 * Allowance for credit losses (PLAN D5 BAD-ALLOW, BAD-DEBT under the allowance method, ACC-26): goldens for the
 * allowance going up and down, per customer and in total, the write-off against it and its refusal when the allowance is
 * short, a recovery (the write-off cancelled, then collected) under both methods, the AR aging and balance sheet net of
 * the allowance, and a property test: every allowance posts exactly the change to its target, 1209 never goes into
 * debit for a customer under per-customer allowances, and the invariants hold.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, createUser, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { addSettingVersion } from '../../../engine/settings.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { releaseDoc } from '../../JO/doctypes/release.ts';
import { invoiceRecordDoc } from '../../JO/doctypes/invoice-record.ts';
import { changeStage } from '../../JO/stages.ts';
import { collectionDoc } from '../doctypes/collection.ts';
import { writeOffDoc } from '../doctypes/write-off.ts';
import { allowanceDoc, type AllowanceInput } from '../doctypes/allowance.ts';
import { allowanceByCustomer } from '../allowance.ts';

let env: TestEnv;
let encoder: Client;
let accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
  [cr, invoiceNo] = [100, 500];
});

const post = (type: string, input: object, total: number, who = accountant, businessDate?: string) =>
  who.post(`/api/docs/${type}/post`, { input, expectedTotalCents: total, ...(businessDate ? { businessDate } : {}) }, idem());
const posted = async (type: string, input: object, total: number, who = accountant): Promise<string> => {
  const r = await post(type, input, total, who);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id;
};
type Preview = { summary: string; totalCents: number; issues: { code: string; level: string; message: string }[]; doc: { lines: { customerName: string; agingCents: number; suggestedCents: number; allowanceCents: number; balanceCents: number; changeCents: number }[] } };
const preview = async (type: string, input: object, who = accountant) => (await who.post(`/api/docs/${type}/preview`, { input })).json() as Preview;
const errors = async (type: string, input: object, who = accountant) => (await preview(type, input, who)).issues.filter((i) => i.level === 'error').map((i) => i.code);
const cancel = (type: string, id: string, who = accountant) => who.post(`/api/docs/${type}/${id}/cancel`, { reason: 'The customer paid after all, recovering it' }, idem());
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const later = async (days: number) => {
  env.clock.advance(days * 24 * 3600_000);
  [encoder, accountant] = [await env.as('encoder'), await env.as('accountant')];
};
const method = (value: 'direct' | 'allowance') =>
  tx(env.db, () => addSettingVersion(env.db, { key: 'acc.bad_debt_method', effectiveFrom: today(env.clock), value, reason: 'Accountant picked the method (ACC-26)', userId: accountant.userId, at: stamp(env.clock), today: today(env.clock) }));

const jobInput = (lines: number[], customerId: string) => ({
  customerId, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50',
  lines: lines.map((cents) => ({ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: cents, discountCents: 0, roster: [] })),
});
/** A recorded one-line JO released in full on credit with its invoice record (due in 7 days): [job order, invoice]. */
async function invoiced(cents: number, customerId: string): Promise<[string, string]> {
  const jo = await posted('jo.job_order', jobInput([cents], customerId), cents, encoder);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to });
  const release = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer', creditDueInDays: 7 };
  const r = await accountant.post('/api/jo/releases', { release, invoice: { invoiceNumber: String(++invoiceNo).padStart(4, '0') }, expectedTotalCents: cents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return [jo, r.json().invoiceRecord.id];
}
let cr = 100;
let invoiceNo = 500;
const collection = (jo: string, cents: number, customerId: string) => ({ customerId, crNumber: String(++cr), applications: [{ jobOrderId: jo, amountCents: cents }], tenders: [{ cashPlaceId: CASH, amountCents: cents }] });

/** Journal lines as [account code, party id, ref, debit, credit]: the document's own, or its reversal. */
const linesOf = (documentId: string, kind: 'original' | 'reversal' = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.source_type = 'document' AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind) as unknown[][];
const mirrored = (id: string) => linesOf(id).map(([code, party, ref, dr, cr]) => [code, party, ref, cr, dr]);
const balanceOf = (code: string, party?: string) =>
  env.db
    .prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ? AND (? IS NULL OR l.party_id = ?)`)
    .pluck()
    .get(code, party ?? null, party ?? null) as number;

/** 1% not yet due, 5% 1–30 days, 10% 31–60, 25% 61–90, 50% over 90. */
const RATES = { currentBp: 100, days1to30Bp: 500, days31to60Bp: 1000, days61to90Bp: 2500, over90Bp: 5000 };
const allowance = (extra: Partial<AllowanceInput> = {}): AllowanceInput => ({ basis: 'customer', ...RATES, reason: 'Month-end review of the AR aging', ...extra });
const writeOff = (invoiceId: string) => ({ invoiceId, reason: 'Customer closed shop and cannot be reached' });

describe('allowance for credit losses (D5 BAD-ALLOW)', () => {
  it('golden: up per customer from the aging (Dr 6270 / Cr 1209 per customer), then down (Dr 1209 / Cr 6270); cancel mirrors on its own date', async () => {
    const [, schoolInv] = await invoiced(5_600_000, c.school);
    const [, otherInv] = await invoiced(1_120_000, c.other);
    expect([schoolInv, otherInv]).toHaveLength(2);
    await later(40); // due 2026-10-05, now 2026-11-07: 33 days overdue, in 31–60
    expect(await errors('col.allowance', allowance())).toEqual(['DIRECT_METHOD']);
    method('allowance');

    const pre = await preview('col.allowance', allowance());
    expect(pre.issues).toEqual([]);
    expect(pre.totalCents).toBe(672_000);
    expect(pre.summary).toBe('This will set the allowance for credit losses on 2026-11-07 (per customer) at ₱6,720.00, from ₱0.00: ₱6,720.00 more charged to bad debts. The provision is not deductible for income tax; only actual write-offs are.');
    const up = await posted('col.allowance', allowance(), 672_000);
    expect(linesOf(up)).toEqual([
      ['6270', c.school, null, 560_000, 0],
      ['1209', c.school, null, 0, 560_000],
      ['6270', c.other, null, 112_000, 0],
      ['1209', c.other, null, 0, 112_000],
    ]);
    expect(await errors('col.allowance', allowance())).toEqual(['NO_CHANGE']);

    // Down: the school's allowance typed at 3,000.00; the other customer's stays at its suggestion, so no line.
    const input = allowance({ customers: [{ customerId: c.school, allowanceCents: 300_000 }] });
    const down = await posted('col.allowance', input, 412_000);
    expect(linesOf(down)).toEqual([
      ['1209', c.school, null, 260_000, 0],
      ['6270', c.school, null, 0, 260_000],
    ]);
    expect(allowanceDoc.toInput(allowanceDoc.load(env.db, down))).toEqual(input);
    expect([balanceOf('1209', c.school), balanceOf('1209', c.other), balanceOf('6270')]).toEqual([-300_000, -112_000, 412_000]);

    // The earlier one comes off only after the later one (D6); each mirrors on its own date.
    expect((await cancel('col.allowance', up)).json().code).toBe('HAS_DEPENDENTS');
    expect((await cancel('col.allowance', down)).statusCode).toBe(200);
    expect(linesOf(down, 'reversal')).toEqual(mirrored(down));
    const dates = env.db.prepare(`SELECT DISTINCT business_date FROM journals WHERE source_id = ?`).pluck().all(down);
    expect(dates).toEqual(['2026-11-07']);
    noBrokenInvariants();
  });

  it('in total: one amount spread over the customers in proportion to their suggestions; a backdated one before a later one is refused', async () => {
    await invoiced(5_600_000, c.school);
    await invoiced(1_120_000, c.other);
    method('allowance');
    // All current at 1%: suggestions 560.00 and 112.00; 1,000.00 in total spreads 833.33 and 166.67.
    const input = allowance({ basis: 'total', neededTotalCents: 100_000 });
    const id = await posted('col.allowance', input, 100_000);
    expect(linesOf(id)).toEqual([
      ['6270', c.school, null, 83_333, 0],
      ['1209', c.school, null, 0, 83_333],
      ['6270', c.other, null, 16_667, 0],
      ['1209', c.other, null, 0, 16_667],
    ]);
    expect(allowanceDoc.toInput(allowanceDoc.load(env.db, id))).toEqual(input);
    expect(await errors('col.allowance', allowance({ basis: 'total', customers: [{ customerId: c.school, allowanceCents: 1 }] }))).toEqual(['BASIS']);
    expect(await errors('col.allowance', allowance({ neededTotalCents: 5 }))).toEqual(['BASIS']);
    await later(3);
    const back = await post('col.allowance', allowance(), 0, accountant, '2026-09-27');
    expect(back.statusCode).toBe(422);
    expect(back.json().details.map((i: { code: string }) => i.code)).toEqual(['LATER_ALLOWANCE']);
    noBrokenInvariants();
  });
});

describe('write-off under the allowance method (D5 BAD-DEBT)', () => {
  it('golden: refused when the allowance is short, naming the shortfall; then Dr 1209 / Cr 1201; recovery: cancel (Dr 1201 / Cr 1209), then the collection', async () => {
    const [jo, inv] = await invoiced(1_120_000, c.other);
    method('allowance');
    await posted('col.allowance', allowance(), 11_200); // 1% current
    const pre = await preview('col.write_off', writeOff(inv));
    expect(pre.issues).toEqual([expect.objectContaining({
      code: 'ALLOWANCE_SHORT', level: 'error',
      message: 'The allowance for credit losses holds for Paper Lantern Club ₱112.00, ₱11,088.00 short of the ₱11,200.00 to write off. Raise the allowance first (Allowance for Credit Losses).',
    })]);

    await posted('col.allowance', allowance({ customers: [{ customerId: c.other, allowanceCents: 1_120_000 }] }), 1_120_000);
    expect((await preview('col.write_off', writeOff(inv))).summary).toBe('This will write off ₱11,200.00 that Paper Lantern Club still owes on invoice no. 0501 (IR-000001, JO-000001) as a bad debt, against the allowance for credit losses. Its output VAT stays as it is, and no payment on it is taken until the write-off is cancelled.');
    const id = await posted('col.write_off', writeOff(inv), 1_120_000);
    expect(linesOf(id)).toEqual([
      ['1209', c.other, null, 1_120_000, 0],
      ['1201', c.other, jo, 0, 1_120_000],
    ]);
    expect(writeOffDoc.load(env.db, id).method).toBe('allowance');
    expect([balanceOf('1209', c.other), balanceOf('1201', c.other)]).toEqual([0, 0]);
    // The allowance under it cannot come off while the write-off stands.
    const acl = env.db.prepare(`SELECT id FROM documents WHERE doc_type = 'col.allowance' ORDER BY number DESC`).pluck().get() as string;
    expect((await cancel('col.allowance', acl)).json().code).toBe('HAS_DEPENDENTS');

    await later(1);
    expect((await cancel('col.write_off', id)).statusCode).toBe(200);
    expect(linesOf(id, 'reversal')).toEqual(mirrored(id));
    expect([balanceOf('1209', c.other), balanceOf('1201', c.other)]).toEqual([-1_120_000, 1_120_000]);
    const col = await posted('col.collection', collection(jo, 1_120_000, c.other), 1_120_000, encoder);
    expect(linesOf(col).at(-1)).toEqual(['1201', c.other, jo, 0, 1_120_000]);
    expect(balanceOf('1201', c.other)).toBe(0);
    noBrokenInvariants();
  });

  it('under direct the write-off stays Dr 6270 / Cr 1201, and a recovery the same way credits 6270; a direct write-off keeps its method after a switch', async () => {
    const [jo, inv] = await invoiced(560_000, c.school);
    const id = await posted('col.write_off', writeOff(inv), 560_000);
    expect(linesOf(id)).toEqual([
      ['6270', c.school, null, 560_000, 0],
      ['1201', c.school, jo, 0, 560_000],
    ]);
    method('allowance');
    expect(writeOffDoc.load(env.db, id).method).toBe('direct');
    await later(1);
    expect((await cancel('col.write_off', id)).statusCode).toBe(200);
    expect(linesOf(id, 'reversal')).toEqual([
      ['6270', c.school, null, 0, 560_000],
      ['1201', c.school, jo, 560_000, 0],
    ]);
    await posted('col.collection', collection(jo, 560_000, c.school), 560_000, encoder);
    expect([balanceOf('1201'), balanceOf('6270'), balanceOf('1209')]).toEqual([0, 0, 0]);
    noBrokenInvariants();
  });

  it('in total, a write-off may use the whole allowance', async () => {
    const [, schoolInv] = await invoiced(5_600_000, c.school);
    await invoiced(1_120_000, c.other);
    method('allowance');
    await posted('col.allowance', allowance({ basis: 'total', neededTotalCents: 6_000_000 }), 6_000_000);
    expect(await errors('col.write_off', writeOff(schoolInv))).toEqual([]);
    await posted('col.write_off', writeOff(schoolInv), 5_600_000);
    expect(-balanceOf('1209')).toBe(400_000);
    noBrokenInvariants();
  });
});

describe('reports show the allowance', () => {
  it('AR aging: per customer, the total and net receivables; balance sheet: trade receivables less the allowance', async () => {
    await invoiced(5_600_000, c.school);
    method('allowance');
    await posted('col.allowance', allowance(), 56_000);
    const aging = (await accountant.get('/api/rpt/ar-aging?asOf=2026-09-28')).json();
    expect(aging.allowance).toEqual([{ customerId: c.school, customerName: 'Moonlight Test School', allowanceCents: 56_000 }]);
    expect([aging.totalCents, aging.allowanceCents, aging.netCents]).toEqual([5_600_000, 56_000, 5_544_000]);
    const csv = (await accountant.get('/api/rpt/ar-aging?asOf=2026-09-28&format=csv')).body;
    expect(csv).toContain('"LESS ALLOWANCE FOR CREDIT LOSSES","","","","","","","","","","-560.00"');
    expect(csv).toContain('"NET RECEIVABLES","","","","","","","","","","55440.00"');
    const bs = (await accountant.get('/api/rpt/balance-sheet?asOf=2026-09-28')).json();
    expect(bs.receivables).toEqual({ tradeCents: 5_600_000, allowanceCents: 56_000, netCents: 5_544_000 });
    const group = bs.sections[0].groups.find((g: { code: string }) => g.code === '1200');
    expect(group.lines.map((l: { code: string; amountCents: number }) => [l.code, l.amountCents])).toEqual([['1201', 5_600_000], ['1209', -56_000]]);
    expect(group.totalCents).toBe(5_544_000);
    expect(bs.balanced).toBe(true);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random allowances (per customer and in total), write-offs, cancels and recoveries: each allowance posts its change exactly; the invariants hold', async () => {
    let number = 30_000;
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv();
        const db = t.db;
        const userId = createUser(db, `prop-${number}`, ['accountant']);
        const cs = seedCustomers(db, userId);
        const actor = { userId, permissions: new Set(['jo.post', 'jo.release', 'jo.release_with_balance', 'jo.invoice', 'col.post', 'col.cancel', 'col.write_off', 'col.allowance', 'acc.backdate']) };
        const e = { db, clock: t.clock };
        const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: (p: string) => actor.permissions.has(p) });
        tx(db, () => addSettingVersion(db, { key: 'acc.bad_debt_method', effectiveFrom: today(t.clock), value: 'allowance', reason: 'Accountant picked the method (ACC-26)', userId, at: stamp(t.clock), today: today(t.clock) }));
        for (let i = 0; i < 3; i++) {
          const customerId = i < 2 ? cs.school : cs.other;
          const cents = g(() => fc.integer({ min: 100_000, max: 3_000_000 }));
          const { id: jo } = postDocument(e, jobOrderDoc, actor, { input: jobInput([cents], customerId), expectedTotalCents: cents });
          for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']] as const) changeStage(db, jo, { from, to }, { userId, at: stamp(t.clock) });
          const relInput = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id' as const, creditNote: 'On account', creditDueInDays: 7 };
          const rel = releaseDoc.compute(relInput, ctx());
          const r = postDocument(e, releaseDoc, actor, { input: relInput, expectedTotalCents: rel.totalCents });
          postDocument(e, invoiceRecordDoc, actor, { input: { releaseId: r.id, invoiceNumber: String(++number) }, expectedTotalCents: rel.totalCents });
        }
        const postedIds = (type: string) => db.prepare(`SELECT id FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];
        const step = fc.constantFrom('allowance', 'allowance', 'allowance', 'writeoff', 'writeoff', 'recover', 'cancel-allowance', 'collect', 'day');
        for (const s of g(() => fc.array(step, { minLength: 5, maxLength: 15 }))) {
          try {
            if (s === 'day') t.clock.advance(g(() => fc.integer({ min: 1, max: 45 })) * 24 * 3600_000);
            else if (s === 'allowance') {
              const input = g(() => allowanceDoc.arbitrary(db));
              const doc = allowanceDoc.compute(input, ctx());
              const before = allowanceByCustomer(db, today(t.clock));
              const p = postDocument(e, allowanceDoc, actor, { input, expectedTotalCents: doc.totalCents });
              const after = allowanceByCustomer(db, today(t.clock));
              for (const l of doc.lines) {
                expect(after.get(l.customerId) ?? 0, s).toBe(l.allowanceCents);
                expect((after.get(l.customerId) ?? 0) - (before.get(l.customerId) ?? 0)).toBe(l.changeCents);
              }
              expect(doc.totalCents).toBe(doc.lines.reduce((n, l) => n + l.allowanceCents, 0));
              if (input.basis === 'total' && input.neededTotalCents !== undefined) expect(doc.totalCents === input.neededTotalCents || doc.totalCents === 0).toBe(true);
              expect(allowanceDoc.toInput(allowanceDoc.load(db, p.id))).toEqual(input);
            } else if (s === 'writeoff') {
              let arb;
              try { arb = writeOffDoc.arbitrary(db); } catch { continue; } // nothing owed anywhere
              const input = g(() => arb);
              const doc = writeOffDoc.compute(input, ctx());
              const p = postDocument(e, writeOffDoc, actor, { input, expectedTotalCents: doc.totalCents });
              expect(linesOf2(db, p.id)[0]).toEqual(['1209', doc.customerId, doc.totalCents, 0]);
            } else if (s === 'recover' || s === 'cancel-allowance') {
              const def = s === 'recover' ? writeOffDoc : allowanceDoc;
              const ids = postedIds(def.key);
              if (ids.length === 0) continue;
              cancelDocument(e, def, actor, g(() => fc.constantFrom(...ids)), 'Recovered, or recorded by mistake');
            } else {
              const open = db.prepare(`SELECT l.ref_doc_id AS jo, l.party_id AS customerId, SUM(l.debit_cents - l.credit_cents) AS cents FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                WHERE a.role_key = 'AR_TRADE' GROUP BY l.ref_doc_id, l.party_id HAVING cents > 0`).all() as { jo: string; customerId: string; cents: number }[];
              if (open.length === 0) continue;
              const o = g(() => fc.constantFrom(...open));
              postDocument(e, collectionDoc, actor, { input: { customerId: o.customerId, crNumber: String(++number), applications: [{ jobOrderId: o.jo, amountCents: o.cents }], tenders: [{ cashPlaceId: cashPlaceId(db, '1101'), amountCents: o.cents }] }, expectedTotalCents: o.cents });
            }
          } catch (err) {
            if (!(err instanceof AppError) || !['HAS_DEPENDENTS', 'VALIDATION'].includes(err.code)) throw err;
            if (err.code === 'VALIDATION' && s === 'writeoff') expect((err.details as { code: string }[]).map((i) => i.code).filter((c) => c !== 'ALLOWANCE_SHORT' && c !== 'NOTHING_OWED' && c !== 'WRITTEN_OFF')).toEqual([]);
          }
          // Only per-customer allowances are in play when no allowance in total is recorded: 1209 then never goes into debit.
          const total = db.prepare(`SELECT COUNT(*) FROM col_allowances a JOIN documents d ON d.id = a.document_id WHERE a.basis = 'total'`).pluck().get() as number;
          if (total === 0) for (const cents of allowanceByCustomer(db, '2999-12-31').values()) expect(cents, s).toBeGreaterThanOrEqual(0);
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 12, endOnFailure: true },
    );
  }, 120_000);
});

const linesOf2 = (db: TestEnv['db'], documentId: string) =>
  db.prepare(`SELECT a.code, l.party_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE j.source_id = ? AND j.posting_kind = 'original' ORDER BY l.line_no`).raw().all(documentId) as unknown[][];
