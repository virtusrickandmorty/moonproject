/**
 * 2550Q gaps, part 2: output VAT on uncollected receivables (EOPT, RMC 65-2024; PLAN E12, K ACC-27). Goldens of the
 * claim (UVAT-: Dr 2301 / Cr 2303, party the customer, 2303 ref the invoice) and the add-back when the customer pays
 * (UVATR-: Dr 2303 / Cr 2301), their cancels, the worksheet lines and the proposal; each requisite the books can check
 * refuses when it fails; and a property test: after any claim and payments, 2303 on the invoice is the claim's VAT on
 * what is still owed, and it empties when the invoice is paid.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { addSettingVersion } from '../../../engine/settings.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { tx } from '../../../platform/db/driver.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { uncollectedVatDoc, uncollectedVatRecoveryDoc } from '../doctypes/uncollected-vat.ts';
import { vatShare } from '../uncollected-vat.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let cr = 100, invoiceNo = 500;

const post = (type: string, input: object, total: number, who = accountant) => who.post(`/api/docs/${type}/post`, { input, expectedTotalCents: total }, idem());
const posted = async (type: string, input: object, total: number, who = accountant): Promise<string> => {
  const r = await post(type, input, total, who);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id;
};
const preview = async (type: string, input: object, who = accountant) =>
  (await who.post(`/api/docs/${type}/preview`, { input })).json() as { summary: string; totalCents: number; issues: { code: string; level: string; message: string }[] };
const errors = async (type: string, input: object) => (await preview(type, input)).issues.filter((i) => i.level === 'error').map((i) => i.code);
const cancel = (type: string, id: string) => accountant.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake, undoing it' }, idem());
const goTo = async (iso: string) => {
  env.clock.set(iso);
  [encoder, accountant] = [await env.as('encoder'), await env.as('accountant')];
};
const turnOn = () => tx(env.db, () => addSettingVersion(env.db, {
  key: 'tax.uncollected_vat_credit', effectiveFrom: today(env.clock), value: true, reason: 'The accountant decided to claim it (ACC-27)',
  userId: accountant.userId, at: stamp(env.clock), today: today(env.clock),
}));

async function jobOrder(cents: number, customerId = c.school): Promise<string> {
  const id = await posted('jo.job_order', { customerId, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50',
    lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: cents, discountCents: 0, roster: [] }] }, cents, encoder);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${id}/stage`, { from, to });
  return id;
}
const collect = (jo: string, cents: number, customerId = c.school) =>
  posted('col.collection', { customerId, crNumber: String(++cr), applications: [{ jobOrderId: jo, amountCents: cents }], tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: cents }] }, cents, encoder);
/** Releases the job order's one line with its invoice record; on credit (a balance still due) for `creditDays`. */
async function invoice(jo: string, grossCents: number, creditDays?: number): Promise<string> {
  const release = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id',
    ...(creditDays ? { creditNote: 'Balance by bank transfer, per the signed order', creditDueInDays: creditDays } : {}) };
  const r = await accountant.post('/api/jo/releases', { release, invoice: { invoiceNumber: String(++invoiceNo).padStart(4, '0') }, expectedTotalCents: grossCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().invoiceRecord.id;
}
const closeQuarter = async (year: number, quarter: number) => {
  const pre = (await accountant.post('/api/docs/tax.vat_close/preview', { input: { year, quarter } })).json();
  return posted('tax.vat_close', { year, quarter }, pre.totalCents);
};
const claimInput = (invoiceId: string, over: object = {}) => ({ invoiceId, writtenAgreement: true, listedInSlsp: true, declaredOnTime: true, notBadDebt: true, ...over });
const linesOf = (documentId: string, kind: 'original' | 'reversal' = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.source_type = 'document' AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind) as unknown[][];
const deferred = (invoiceId: string) =>
  env.db.prepare(`SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '2303' AND l.ref_doc_id = ?`)
    .pluck().get(invoiceId) as number;
const items = (w: { lines: { key: string; amountCents: number | null; taxCents: number }[] }) => Object.fromEntries(w.lines.map((l) => [l.key, [l.amountCents, l.taxCents]]));
const worksheet = async (year: number, quarter: number) => (await accountant.get(`/api/tax/2550q?year=${year}&quarter=${quarter}`)).json();
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env); // 2026-09-28, in Q3
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  env.db.prepare('UPDATE cus_customers SET registered_name = ?, tin = ?, is_vat_registered = 1 WHERE id = ?').run('Made-up School Foundation, Inc.', '111-222-333-00000', c.school);
  [cr, invoiceNo] = [100, 500];
});

/** A ₱11,200.00 credit sale on 28 September, due 29 September (Q3), declared in the Q3 close on 5 October; the credit turned on. */
async function unpaidQ3Sale() {
  const jo = await jobOrder(1_120_000);
  const inv = await invoice(jo, 1_120_000, 1);
  await goTo('2026-10-05T02:00:00Z');
  await closeQuarter(2026, 3);
  turnOn();
  return { jo, inv };
}

describe('output VAT on uncollected receivables (UVAT-, UVATR-)', () => {
  it('golden: the claim Dr 2301 / Cr 2303 with the invoice as ref, on its own worksheet line; the add-backs as the customer pays; cancels mirror', async () => {
    const { jo, inv } = await unpaidQ3Sale();
    const listed = (await accountant.get('/api/tax/uncollected-vat')).json();
    expect(listed).toMatchObject({ enabled: true, claimable: [{ invoiceId: inv, invoiceNumber: '0501', owedCents: 1_120_000, vatCents: 120_000, dueDate: '2026-09-29' }], addBacksDue: [] });
    expect((await worksheet(2026, 4)).checks.map((x: { code: string }) => x.code)).toContain('UNCOLLECTED_TO_CLAIM');

    const pre = await preview('tax.uncollected_vat', claimInput(inv));
    expect(pre.issues).toEqual([]);
    expect(pre.summary).toBe("This will take ₱1,200.00 output VAT off this quarter's 2550Q for invoice no. 0501 (IR-000001, JO-000001) of Moonlight Test School: "
      + '₱11,200.00 of ₱11,200.00 is still owed after the agreed time to pay ended on 2026-09-29. It is added back when the customer pays.');
    const claim = await posted('tax.uncollected_vat', claimInput(inv, { note: 'Customer asked for more time' }), 120_000);
    expect(linesOf(claim)).toEqual([['2301', c.school, null, 120_000, 0], ['2303', c.school, inv, 0, 120_000]]);
    expect(uncollectedVatDoc.toInput(uncollectedVatDoc.load(env.db, claim))).toEqual(claimInput(inv, { note: 'Customer asked for more time' }));
    let w = await worksheet(2026, 4);
    expect(items(w)).toMatchObject({ uncollected_receivables: [null, -120_000], recovered_receivables: [null, 0], output_tax: [0, -120_000] });
    expect(w.checks.map((x: { code: string }) => x.code)).not.toContain('OUTPUT_NOT_TIED');
    // The sale stays in Q3's register and SLSP; the claim is in no register.
    expect((await accountant.get('/api/tax/registers/sales?from=2026-10-01&to=2026-12-31')).json().rows).toEqual([]);

    // Half paid: ₱600.00 of the VAT comes back.
    await goTo('2026-11-10T02:00:00Z');
    await collect(jo, 560_000);
    expect((await accountant.get('/api/tax/uncollected-vat')).json().addBacksDue).toEqual([
      { claimId: claim, claimNumber: 'UVAT-000001', invoiceId: inv, invoiceNumber: '0501', customerName: 'Moonlight Test School', paidCents: 560_000, vatCents: 60_000 },
    ]);
    expect((await worksheet(2026, 4)).checks.map((x: { code: string }) => x.code)).toContain('ADD_BACK_DUE');
    const back1 = await posted('tax.uncollected_vat_recovery', { claimId: claim }, 60_000);
    expect(linesOf(back1)).toEqual([['2303', c.school, inv, 60_000, 0], ['2301', c.school, null, 0, 60_000]]);
    expect(deferred(inv)).toBe(60_000);
    expect(await errors('tax.uncollected_vat_recovery', { claimId: claim })).toEqual(['NOTHING_PAID']);

    // Paid in full: the rest comes back and 2303 is empty.
    await collect(jo, 560_000);
    expect((await preview('tax.uncollected_vat_recovery', { claimId: claim })).summary).toBe(
      "This will add ₱600.00 output VAT back to this quarter's 2550Q: Moonlight Test School paid ₱11,200.00 on invoice no. 0501 (IR-000001) since its output VAT was claimed on UVAT-000001.");
    const back2 = await posted('tax.uncollected_vat_recovery', { claimId: claim }, 60_000);
    expect(deferred(inv)).toBe(0);
    expect(uncollectedVatRecoveryDoc.toInput(uncollectedVatRecoveryDoc.load(env.db, back2))).toEqual({ claimId: claim });
    w = await worksheet(2026, 4);
    expect(items(w)).toMatchObject({ uncollected_receivables: [null, -120_000], recovered_receivables: [null, 120_000], output_tax: [0, 0] });

    // Cancels: the claim waits for its add-backs; each mirror nets to nothing.
    expect((await cancel('tax.uncollected_vat', claim)).json().code).toBe('HAS_DEPENDENTS');
    for (const id of [back2, back1]) {
      expect((await cancel('tax.uncollected_vat_recovery', id)).statusCode).toBe(200);
      expect(linesOf(id, 'reversal')).toEqual(linesOf(id).map(([code, party, ref, dr, crd]) => [code, party, ref, crd, dr]));
    }
    expect((await cancel('tax.uncollected_vat', claim)).statusCode).toBe(200);
    expect(linesOf(claim, 'reversal')).toEqual([['2301', c.school, null, 0, 120_000], ['2303', c.school, inv, 120_000, 0]]);
    expect(deferred(inv)).toBe(0);
    noBrokenInvariants();
  });

  it('the VAT close of the claim quarter closes 2301 net of the claim; 2303 stays', async () => {
    const { inv } = await unpaidQ3Sale();
    await posted('tax.uncollected_vat', claimInput(inv), 120_000);
    await goTo('2027-01-05T02:00:00Z');
    const pre = (await accountant.post('/api/docs/tax.vat_close/preview', { input: { year: 2026, quarter: 4 } })).json();
    expect(pre.summary).toBe('This will close the VAT of Q4 2026: output -₱1,200.00, less input ₱0.00: ₱1,200.00 carried over to the next quarter.');
    await closeQuarter(2026, 4);
    expect(items(await worksheet(2026, 4))).toMatchObject({ output_tax: [0, -120_000], carry_forward: [null, 120_000] });
    expect(deferred(inv)).toBe(120_000);
    noBrokenInvariants();
  });

  it('refuses when a requisite the books can check fails, or a confirmation is missing', async () => {
    const jo = await jobOrder(1_120_000);
    const inv = await invoice(jo, 1_120_000, 1);
    const later = await invoice(await jobOrder(560_000), 560_000, 30); // due 28 October, in Q4
    const paidJo = await jobOrder(224_000);
    await collect(paidJo, 224_000);
    const cash = await invoice(paidJo, 224_000); // paid before release: no time to pay
    const writtenOff = await invoice(await jobOrder(336_000), 336_000, 1);
    expect(await errors('tax.uncollected_vat', claimInput(inv))).toEqual(['SETTING_OFF', 'NOT_DECLARED', 'TIME_TO_PAY']); // due tomorrow

    await goTo('2026-10-05T02:00:00Z');
    expect(await errors('tax.uncollected_vat', claimInput(inv))).toEqual(['SETTING_OFF', 'NOT_DECLARED']); // 8 days on: not closed yet
    turnOn();
    expect(await errors('tax.uncollected_vat', claimInput(inv))).toEqual(['NOT_DECLARED']);
    await closeQuarter(2026, 3);
    expect(await errors('tax.uncollected_vat', claimInput(inv))).toEqual([]);
    expect(await errors('tax.uncollected_vat', claimInput(inv, { writtenAgreement: false, notBadDebt: false }))).toEqual(['CONFIRM', 'CONFIRM']);
    expect(await errors('tax.uncollected_vat', claimInput(later))).toEqual(['TIME_TO_PAY']);
    expect(await errors('tax.uncollected_vat', claimInput(cash))).toEqual(['NOT_ON_CREDIT', 'NOTHING_OWED']);
    expect(await errors('tax.uncollected_vat', claimInput('no-such-invoice'))).toEqual(['INVOICE']);
    await posted('col.write_off', { invoiceId: writtenOff, reason: 'Customer closed shop and cannot be reached' }, 336_000);
    expect(await errors('tax.uncollected_vat', claimInput(writtenOff))).toEqual(['WRITTEN_OFF', 'NOTHING_OWED']);
    await posted('tax.uncollected_vat', claimInput(inv), 120_000);
    expect(await errors('tax.uncollected_vat', claimInput(inv))).toEqual(['CLAIMED_ALREADY']);
    // Only the accountant may claim.
    expect((await post('tax.uncollected_vat', claimInput(later), 60_000, encoder)).statusCode).toBe(403);
    // The school with no TIN on file: a warning (the SLSP did not list the sale on its own).
    env.db.prepare('UPDATE cus_customers SET tin = NULL WHERE id = ?').run(c.school);
    await goTo('2027-01-05T02:00:00Z');
    const issues = (await preview('tax.uncollected_vat', claimInput(later))).issues;
    expect(issues.map((i) => [i.level, i.code])).toEqual([['warning', 'NO_TIN']]);
  });

  it('refuses a sale on or before 27 April 2024, and one with no VAT shown', async () => {
    env = await createTestEnv('2024-04-20T02:00:00Z'); encoderOwnDefaults(env);
    [encoder, accountant] = [await env.as('encoder'), await env.as('accountant')];
    c = seedCustomers(env.db, encoder.userId);
    const early = await invoice(await jobOrder(1_120_000), 1_120_000, 1);
    tx(env.db, () => addSettingVersion(env.db, { key: 'tax.vat_rate_bp', effectiveFrom: today(env.clock), value: 0, reason: 'Test: an invoice with no VAT', userId: accountant.userId, at: stamp(env.clock), today: today(env.clock) }));
    const noVat = await invoice(await jobOrder(100_000), 100_000, 1);
    await goTo('2024-07-05T02:00:00Z');
    await closeQuarter(2024, 2);
    turnOn();
    expect(await errors('tax.uncollected_vat', claimInput(early))).toEqual(['SALE_BEFORE_EOPT']);
    expect(await errors('tax.uncollected_vat', claimInput(noVat))).toEqual(['SALE_BEFORE_EOPT', 'NO_VAT_SHOWN']);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('after a claim and any payments with their add-backs, 2303 on the invoice = the claim VAT on what is still owed; paid in full, it is empty', async () => {
    const grosses = [1_120_000, 999_900, 5_600_035, 123_457];
    const invoices: { jo: string; inv: string; gross: number }[] = [];
    for (const gross of grosses) {
      const jo = await jobOrder(gross);
      invoices.push({ jo, inv: await invoice(jo, gross, 1), gross });
    }
    await goTo('2026-10-05T02:00:00Z');
    await closeQuarter(2026, 3);
    turnOn();
    let next = 0;
    await fc.assert(
      fc.asyncProperty(uncollectedVatDoc.arbitrary(env.db), fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 4 }), async (input, shares) => {
        const { jo, inv, gross } = invoices[next++ % invoices.length]!;
        const pre = await preview('tax.uncollected_vat', { ...input, invoiceId: inv });
        if (pre.issues.some((i) => i.code === 'CLAIMED_ALREADY')) return;
        const claimVat = vatShare(Math.round((gross * 12) / 112), gross, gross);
        expect(pre.totalCents).toBe(claimVat);
        const claim = await posted('tax.uncollected_vat', { ...input, invoiceId: inv }, pre.totalCents);
        let owed = gross;
        for (const s of shares) {
          const pay = Math.max(1, Math.min(owed, Math.floor((gross * s) / 100)));
          await collect(jo, pay);
          owed -= pay;
          const back = await preview('tax.uncollected_vat_recovery', { claimId: claim });
          if (back.totalCents > 0) await posted('tax.uncollected_vat_recovery', { claimId: claim }, back.totalCents);
          expect(deferred(inv)).toBe(vatShare(claimVat, owed, gross));
          if (owed === 0) break;
        }
        if (owed > 0) {
          await collect(jo, owed);
          await posted('tax.uncollected_vat_recovery', { claimId: claim }, (await preview('tax.uncollected_vat_recovery', { claimId: claim })).totalCents);
        }
        expect(deferred(inv)).toBe(0);
        noBrokenInvariants();
      }),
      { numRuns: grosses.length },
    );
  });
});
