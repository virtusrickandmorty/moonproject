/**
 * Job Order: golden G-01 (the JO part, PLAN I2), balance due through G-01..G-03 (D3), roster, stages (E4),
 * cancel and edit (D6), API rules and property tests. A JO posts no journal (D5 JO-POST), so its golden is
 * "no journal lines at all".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp } from '../../../platform/clock.ts';
import { jobOrderDoc, type JobOrderInput } from '../doctypes/job-order.ts';
import { balanceDue, joLedger } from '../public.ts';
import { postJournal, type DraftLine } from '../../../engine/ledger/post.ts';
import { changeStage, currentStage, movesFrom, type Stage } from '../stages.ts';
import { seedCustomers } from './cus-fixture.ts';

let env: TestEnv;
let encoder: Client;
let c: ReturnType<typeof seedCustomers>;

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
});

const JO = '/api/docs/jo.job_order';
const post = (input: object, total: number, who = encoder) => who.post(`${JO}/post`, { input, expectedTotalCents: total }, idem());
const issues = async (input: object) => (await encoder.post(`${JO}/preview`, { input })).json().issues as { level: string; message: string }[];
const status = async (id: string) => (await encoder.get(`/api/jo/orders/${id}/status`)).json();
const stage = (id: string, body: object, who = encoder) => who.post(`/api/jo/orders/${id}/stage`, body);
const count = (sql: string) => (env.db.prepare(sql).get() as { n: number }).n;
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

/** G-01: ₱56,000.00 on one made-to-order line (20 × ₱2,800.00), 50% downpayment terms. */
const g01 = (): JobOrderInput => ({
  customerId: c.school,
  dueInDays: 15,
  priority: 'normal',
  paymentTerms: 'dp50',
  lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 20, unitPriceCents: 280_000, discountCents: 0, roster: [] }],
});
const withRoster = (qty: number, roster: object[]) => ({ ...g01(), lines: [{ ...g01().lines[0]!, qty, roster }] });

describe('Job Order golden (PLAN I2 G-01, the JO part)', () => {
  it('records JO-000001 for ₱56,000.00 and posts no journal (D5 JO-POST)', async () => {
    const pre = (await encoder.post(`${JO}/preview`, { input: g01() })).json();
    expect(pre.summary).toBe(
      'This will record a job order for Moonlight Test School: 20 pieces, ₱56,000.00, due 2026-10-13. Downpayment asked: ₱28,000.00. Nothing goes into the books until the invoice is recorded at release.',
    );
    expect(pre.journal).toBeUndefined();
    expect((await (await env.as('accountant')).post(`${JO}/preview`, { input: g01() })).json().journal).toBeNull();

    const res = await post(g01(), 5_600_000);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'JO-000001', businessDate: '2026-09-28', totalCents: 5_600_000, journalNumber: null });
    expect(count('SELECT COUNT(*) AS n FROM journal_lines')).toBe(0);
    const view = (await encoder.get(`${JO}/${res.json().id}`)).json();
    expect(view.doc).toMatchObject({ customerName: 'Moonlight Test School', dueDate: '2026-10-13', requiredDownpaymentCents: 2_800_000 });
    expect(view.input).toEqual(g01());
    expect((await status(res.json().id)).money).toEqual({
      totalCents: 5_600_000, invoicedCents: 0, requiredDownpaymentCents: 2_800_000, receivableCents: 0, depositsHeldCents: 0,
      balanceDueCents: 5_600_000, collectedCents: 0, notInvoicedCents: 5_600_000,
    });
    noBrokenInvariants();
  });

  it('balance due follows D3 through G-01, G-02 and G-03', () => {
    const jo = { totalCents: 5_600_000 };
    // G-01 downpayment ₱28,000 cash: Cr 2201 (customer, JO).
    expect(balanceDue({ ...jo, invoicedCents: 0, receivableCents: 0, depositsHeldCents: 2_800_000 })).toEqual({ balanceDueCents: 2_800_000, collectedCents: 2_800_000, notInvoicedCents: 5_600_000 });
    // G-02 release with invoice 0501: Dr 1201 56,000; deposit applied Dr 2201 / Cr 1201 28,000. Open AR = balance due.
    expect(balanceDue({ ...jo, invoicedCents: 5_600_000, receivableCents: 2_800_000, depositsHeldCents: 0 })).toEqual({ balanceDueCents: 2_800_000, collectedCents: 2_800_000, notInvoicedCents: 0 });
    // G-03 balance collected: GCash 10,000 + cash 17,750 + CWT 250 = Cr 1201 28,000.
    expect(balanceDue({ ...jo, invoicedCents: 5_600_000, receivableCents: 0, depositsHeldCents: 0 })).toEqual({ balanceDueCents: 0, collectedCents: 5_600_000, notInvoicedCents: 0 });
  });

  it("reads the JO's own AR and deposits from lines tagged with the JO (G-01, G-02 journals)", async () => {
    const jo = (await post(g01(), 5_600_000)).json().id as string;
    const other = (await post(g01(), 5_600_000)).json().id as string;
    const party = { type: 'customer', id: c.school };
    const journal = (id: string, lines: DraftLine[]) =>
      tx(env.db, () => postJournal(env.db, { memo: id, lines }, { sourceType: 'test', sourceId: id, businessDate: '2026-09-28', userId: encoder.userId, at: stamp(env.clock) }));
    const deposit = (ref: string, cents: number): DraftLine[] => [
      { account: { cashPlace: cashPlaceId(env.db, '1101') }, debitCents: cents },
      { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref: { documentId: ref }, creditCents: cents },
    ];
    // G-01 DEP-RCV: Dr 1101 28,000.00 / Cr 2201 28,000.00 (party Test School, JO). Another JO's deposit stays out.
    journal('dep-1', deposit(jo, 2_800_000));
    journal('dep-2', deposit(other, 1_000_000));
    expect((await status(jo)).money).toMatchObject({ receivableCents: 0, depositsHeldCents: 2_800_000, balanceDueCents: 2_800_000, collectedCents: 2_800_000 });
    // G-02 invoice 0501 and deposit applied. Invoiced amounts come with the invoice record, so only the ledger parts are checked here.
    const ref = { documentId: jo };
    journal('inv-0501', [
      { account: { role: 'AR_TRADE' }, party, ref, debitCents: 5_600_000 },
      { account: { role: 'SALES_MTO' }, party, creditCents: 5_000_000 },
      { account: { role: 'OUTPUT_VAT' }, party, creditCents: 600_000 },
      { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref, debitCents: 2_800_000 },
      { account: { role: 'AR_TRADE' }, party, ref, creditCents: 2_800_000 },
    ]);
    expect(joLedger(env.db, jo)).toEqual({ receivableCents: 2_800_000, depositsHeldCents: 0 });
    expect(joLedger(env.db, other)).toEqual({ receivableCents: 0, depositsHeldCents: 1_000_000 });
    noBrokenInvariants();
  });
});

describe('roster (PLAN E4)', () => {
  it('pulls a group with active chart revisions and records the roster', async () => {
    expect((await encoder.get(`/api/jo/groups/${c.team}/roster`)).json()).toEqual([
      { personId: c.ari, wearerName: 'Ari Sample', sizeMode: 'preset', jerseyName: 'ARI', jerseyNumber: '7', qty: 1 },
      { personId: c.bea, wearerName: 'Bea Example', sizeMode: 'measured', qty: 1 },
    ]);
    const roster = [
      { personId: c.ari, sizeMode: 'preset', size: 'L', jerseyName: 'ari', jerseyNumber: '7', qty: 1 },
      { personId: c.bea, sizeMode: 'measured', qty: 1 },
      { name: 'Guest Coach', sizeMode: 'preset', size: 'XL', qty: 2 },
    ];
    expect((await post(withRoster(4, roster), 1_120_000)).statusCode).toBe(200);
    expect(env.db.prepare('SELECT wearer_name, group_id, size, chart_id, chart_revision, jersey_name FROM jo_roster ORDER BY row_no').raw().all()).toEqual([
      ['Ari Sample', c.team, 'L', null, null, 'ARI'],
      ['Bea Example', c.team, null, c.beaChart, 2, null],
      ['Guest Coach', null, 'XL', null, null, null],
    ]);
  });

  it('checks the roster against the line and the customer', async () => {
    const one = (row: object) => withRoster(1, [{ sizeMode: 'preset', size: 'M', qty: 1, ...row }]);
    const errors = async (input: object) => (await issues(input)).filter((i) => i.level === 'error').map((i) => i.message);
    expect(await errors(withRoster(5, [{ personId: c.ari, sizeMode: 'preset', size: 'M', qty: 4 }]))).toEqual(['Line 1 is for 5 pieces but the roster lists 4.']);
    expect(await errors(one({ personId: c.outsider }))).toEqual(["Line 1, row 1: pick one of Moonlight Test School's active wearers."]);
    expect(await errors(one({ personId: c.cy, sizeMode: 'measured', size: undefined }))).toEqual(['Line 1, row 1: Cy Placeholder has no measurements on file. Measure first or pick a size.']);
    expect(await errors(one({}))).toEqual(['Line 1, row 1: pick a wearer from the list or type a one-off name.']);
    expect(await errors(one({ name: 'Walk-in', size: undefined }))).toEqual(['Line 1, row 1: pick a size.']);
    expect(await errors({ ...g01(), lines: [{ ...g01().lines[0]!, discountCents: 5_600_001 }] })).toEqual(['Line 1: the discount is more than the line amount.']);
    expect(await errors({ ...g01(), customerId: c.closed })).toEqual(['Closed Test Shop is inactive. Pick an active customer.']);
    const twice = await post(withRoster(2, [{ personId: c.ari, sizeMode: 'preset', size: 'M', qty: 1 }, { personId: c.ari, sizeMode: 'preset', size: 'L', qty: 1 }]), 560_000);
    expect(twice.json().warnings.map((w: { message: string }) => w.message)).toEqual(['Line 1, row 2: Ari Sample is already on this line.']);
    expect((await post(withRoster(3, [{ name: 'Only One', sizeMode: 'preset', size: 'M', qty: 1 }]), 840_000)).statusCode).toBe(422);
  });
});

describe('API rules', () => {
  it('rejects client-sent dates, numbers, totals and statuses (N-03)', async () => {
    for (const extra of [{ date: '2026-09-01' }, { dueDate: '2026-10-01' }, { number: 'JO-9' }, { totalCents: 1 }, { status: 'open' }, { requiredDownpaymentCents: 0 }]) {
      expect((await post({ ...g01(), ...extra }, 5_600_000)).statusCode, JSON.stringify(extra)).toBe(400);
    }
  });

  it('refuses a total over the typo guard with a message, not a crash', async () => {
    const huge = { ...g01(), lines: Array(50).fill({ ...g01().lines[0]!, qty: 10_000, unitPriceCents: 100_000_000_00 }) };
    const r = await post(huge, 50 * 10_000 * 100_000_000_00);
    expect(r.statusCode).toBe(422);
    expect(r.json().message).toBe('The total is over ₱100 million. Please check the quantities and prices.');
  });

  it('needs the right permission (N-04)', async () => {
    const { id } = (await post(g01(), 5_600_000)).json();
    const [tv, production] = [await env.as('tv'), await env.as('production')];
    expect((await post(g01(), 5_600_000, tv)).statusCode).toBe(403);
    expect((await production.get(`/api/jo/orders/${id}/status`)).statusCode).toBe(403);
    expect((await stage(id, { from: 'open', to: 'in_production' }, production)).statusCode).toBe(403);
    expect((await production.get(`/api/jo/groups/${c.team}/roster`)).statusCode).toBe(403);
  });
});

describe('stages (PLAN E4)', () => {
  it('moves by hand along the allowed paths, with history and an audit row each', async () => {
    const { id } = (await post(g01(), 5_600_000)).json();
    expect((await stage(id, { from: 'open', to: 'in_production' })).json()).toEqual({ stage: 'in_production', seq: 1 });
    expect((await stage(id, { from: 'open', to: 'in_production' })).json().code).toBe('STAGE_CHANGED'); // double click
    expect((await stage(id, { from: 'in_production', to: 'released' })).json().code).toBe('STAGE_NOT_ALLOWED');
    expect((await stage(id, { from: 'in_production', to: 'ready' })).statusCode).toBe(200);
    expect((await stage(id, { from: 'ready', to: 'in_production' })).json().code).toBe('REASON_REQUIRED');
    expect((await stage(id, { from: 'ready', to: 'in_production', reason: 'Collar stitching failed QC' })).statusCode).toBe(200);
    const s = await status(id);
    expect(s).toMatchObject({ stage: 'in_production', stageLabel: 'In production' });
    expect(s.moves).toEqual([{ to: 'ready', label: 'Ready for release', needsReason: false }, { to: 'open', label: 'Open', needsReason: true }]);
    expect(s.history.map((h: { toStage: string }) => h.toStage)).toEqual(['in_production', 'ready', 'in_production']);
    expect(count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'jo.stage'`)).toBe(3);
    // The database refuses a stage row that does not follow on, and any edit of the history.
    const insert = env.db.prepare(`INSERT INTO jo_stage_events (document_id, seq, from_stage, to_stage, at, user_id) VALUES (?, 4, 'open', 'closed', 'x', ?)`);
    expect(() => insert.run(id, encoder.userId)).toThrow(/JO_STAGE/);
    expect(() => env.db.prepare(`UPDATE jo_stage_events SET reason = 'x' WHERE document_id = ?`).run(id)).toThrow(/IMMUTABLE/);
    noBrokenInvariants();
  });
});

describe('cancel and edit (PLAN D6, NR-4)', () => {
  it('cancel posts nothing, freezes the stage and leaves nothing owed', async () => {
    const { id } = (await post(g01(), 5_600_000)).json();
    await stage(id, { from: 'open', to: 'in_production' });
    expect((await encoder.post(`${JO}/${id}/cancel`, { reason: 'Customer called off the order' }, idem())).statusCode).toBe(200);
    const s = await status(id);
    expect(s).toMatchObject({ stage: 'cancelled', moves: [] });
    expect(s.money).toMatchObject({ totalCents: 0, balanceDueCents: 0 });
    expect((await stage(id, { from: 'in_production', to: 'ready' })).json().code).toBe('JO_CANCELLED');
    expect(count('SELECT COUNT(*) AS n FROM journals')).toBe(0);
    noBrokenInvariants();
  });

  it('edit = cancel + new number; the replacement keeps the stage', async () => {
    const first = (await post(g01(), 5_600_000)).json();
    await stage(first.id, { from: 'open', to: 'in_production' });
    const input = { ...g01(), lines: [{ ...g01().lines[0]!, unitPriceCents: 300_000 }] };
    const r = await encoder.post(`${JO}/${first.id}/reissue`, { input, expectedTotalCents: 6_000_000, reason: 'Price agreed again with the school' }, idem());
    expect(r.json()).toMatchObject({ number: 'JO-000002', totalCents: 6_000_000 });
    const s = await status(r.json().id);
    expect(s.stage).toBe('in_production');
    expect(s.history[0]).toMatchObject({ fromStage: 'open', toStage: 'in_production', reason: 'Carried over from JO-000001' });
    expect((await encoder.get(`${JO}/${first.id}`)).json().header).toMatchObject({ status: 'cancelled', replacedById: r.json().id });
    noBrokenInvariants();
  });

  it('an invalid replacement changes nothing', async () => {
    const first = (await post(g01(), 5_600_000)).json();
    await stage(first.id, { from: 'open', to: 'in_production' });
    const bad = withRoster(20, [{ name: 'Only One', sizeMode: 'preset', size: 'M', qty: 1 }]);
    expect((await encoder.post(`${JO}/${first.id}/reissue`, { input: bad, expectedTotalCents: 5_600_000, reason: 'Adding the roster now' }, idem())).statusCode).toBe(422);
    expect((await encoder.get(`${JO}/${first.id}`)).json().header.status).toBe('posted');
    expect((await status(first.id)).stage).toBe('in_production');
    expect(count('SELECT COUNT(*) AS n FROM documents')).toBe(1);
  });
});

describe('property tests (PLAN I1.3)', () => {
  it('random job orders: stored = computed, totals add up, stages follow on, no journals, gapless numbers', () => {
    const actor = { userId: encoder.userId, permissions: new Set(['jo.create', 'jo.post', 'jo.cancel']) };
    const e = { db: env.db, clock: env.clock };
    const ctx = { db: env.db, businessDate: '2026-09-28', at: stamp(env.clock), userId: encoder.userId, can: () => true };
    const ops = fc.array(fc.tuple(jobOrderDoc.arbitrary(env.db), fc.nat(4), fc.constantFrom('keep', 'cancel', 'reissue')), { minLength: 1, maxLength: 5 });
    fc.assert(
      fc.property(ops, (list) => {
        for (const [input, moves, then] of list) {
          const doc = jobOrderDoc.compute(jobOrderDoc.inputSchema.parse(input), ctx);
          expect(doc.totalCents).toBe(input.lines.reduce((s, l) => s + l.qty * l.unitPriceCents - l.discountCents, 0));
          expect(doc.requiredDownpaymentCents).toBeLessThanOrEqual(doc.totalCents);
          const p = postDocument(e, jobOrderDoc, actor, { input, expectedTotalCents: doc.totalCents });
          expect(jobOrderDoc.load(env.db, p.id)).toEqual(doc);
          expect(jobOrderDoc.compute(jobOrderDoc.toInput(doc), ctx)).toEqual(doc);
          for (let i = 0; i < moves; i++) {
            const now = currentStage(env.db, p.id) as Stage;
            const to = movesFrom(now)[0]!.to;
            tx(env.db, () => changeStage(env.db, p.id, { from: now, to, reason: 'Checked again at the QC desk' }, { userId: encoder.userId, at: ctx.at }));
          }
          const before = currentStage(env.db, p.id);
          if (then === 'cancel') cancelDocument(e, jobOrderDoc, actor, p.id, 'Recorded twice by mistake');
          if (then === 'reissue') {
            const r = reissueDocument(e, jobOrderDoc, actor, p.id, { input, expectedTotalCents: doc.totalCents, reason: 'Customer changed the order' });
            expect(currentStage(env.db, r.id)).toBe(before);
          }
        }
        expect(count('SELECT COUNT(*) AS n FROM journals')).toBe(0);
        noBrokenInvariants();
      }),
      { numRuns: 30 },
    );
  });
});
