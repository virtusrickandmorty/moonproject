/**
 * Opening statutory payable (OBST-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): Dr 3900 / Cr 2401–2405 and 2310 per
 * employee, tagged with the contribution month exactly as a payroll run's, so the month's payable and a remittance
 * (REM-) of that month see it and pay it; its refusals; its cancel landing on the cut-over date; a property test. Made-up
 * people only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { AppError } from '@moonproject/shared';
import { formatPeso, formatPesos } from '@moonproject/shared';
import { PASSWORD, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { resolveDraft } from '../../../engine/ledger/post.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { stamp } from '../../../platform/clock.ts';
import { addEmployee } from '../../EMP/tests/fixture.ts';
import { openingStatDoc, type OpeningStatInput } from '../doctypes/opening.ts';
import { payableByEmployee, schemeCheck, statMonths } from '../ledger.ts';

const CUTOVER = '2026-09-27'; // the day before the test clock's 2026-09-28

let env: TestEnv;
let accountant: Client, encoder: Client, owner: Client;
let BDO: number;
let ana: string, ben: string, cy: string;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28 10:00 Manila
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
  owner = await env.as('owner');
  BDO = cashPlaceId(env.db, '1111');
  ana = addEmployee(env.db, 'Ana Araw');
  ben = addEmployee(env.db, 'Ben Halo');
  cy = addEmployee(env.db, 'Cy Buwan', { costCentre: 'office' });
});

const stepUp = (c: Client) => c.post('/api/auth/step-up', { password: PASSWORD });
const setCutover = async (date = CUTOVER) => {
  await stepUp(accountant);
  return accountant.post('/api/acc/opening/cutover-date', { date });
};
/** Ana: SSS 2,110.00, PhilHealth 717.30, Pag-IBIG 400.00. Ben: SSS 2,280.00, a SSS and a Pag-IBIG loan. Cy: withholding tax. */
const input = (over: Partial<OpeningStatInput> = {}): OpeningStatInput => ({
  month: '2026-08',
  employees: [
    { employeeId: ana, sssCents: 211_000, phicCents: 71_730, hdmfCents: 40_000 },
    { employeeId: ben, sssCents: 228_000, sssLoanCents: 50_000, hdmfLoanCents: 30_000 },
    { employeeId: cy, wtaxCents: 170_115 },
  ],
  ...over,
});
const totalOf = (i: OpeningStatInput) => i.employees.reduce((s, e) => s + (e.sssCents ?? 0) + (e.phicCents ?? 0) + (e.hdmfCents ?? 0) + (e.wtaxCents ?? 0) + (e.sssLoanCents ?? 0) + (e.hdmfLoanCents ?? 0), 0);
const open = (i: OpeningStatInput, businessDate: string | null = CUTOVER, who = accountant) =>
  who.post('/api/docs/stat.opening/post', { input: i, expectedTotalCents: totalOf(i), ...(businessDate ? { businessDate } : {}) }, idem());
const errors = async (i: OpeningStatInput, businessDate: string | null = CUTOVER) => {
  const r = await accountant.post('/api/docs/stat.opening/preview', { input: i, ...(businessDate ? { businessDate } : {}) });
  return r.json().issues.filter((x: { level: string }) => x.level === 'error').map((x: { code: string }) => x.code);
};
const cancel = (c: Client, type: string, id: string) => c.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake at cut-over' }, idem());
/** The document's journal per account and employee, e.g. "2401 Cr 2,110.00 Ana Araw", sorted by account then name. */
function journal(documentId: string, kind: 'original' | 'reversal' = 'original'): string[] {
  const rows = env.db
    .prepare(
      `SELECT a.code, l.debit_cents AS dr, l.credit_cents AS cr, e.full_name AS name FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       LEFT JOIN emp_employees e ON e.id = l.party_id WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY a.code, name`,
    )
    .all(documentId, kind) as { code: string; dr: number; cr: number; name: string | null }[];
  return rows.map((r) => `${r.code} ${r.dr ? 'Dr' : 'Cr'} ${formatPesos(r.dr || r.cr)}${r.name ? ` ${r.name}` : ''}`);
}
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

describe('opening statutory payable golden (PLAN D8 step 3, E11)', () => {
  it('one month for three employees: Dr 3900 / Cr 2401, 2402, 2403, 2310, 2404, 2405 per employee', async () => {
    await setCutover();
    const i = input();
    const pre = await accountant.post('/api/docs/stat.opening/preview', { input: i, businessDate: CUTOVER });
    expect(pre.json()).toMatchObject({
      totalCents: totalOf(i),
      issues: [],
      summary: `This will record ${formatPeso(totalOf(i))} still to remit for 2026-08 (SSS, PhilHealth, Pag-IBIG and withholding tax and loan amortizations) for 3 employees, as open on the cut-over date ${CUTOVER}.`,
    });

    const res = await open(i);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'OBST-000001', businessDate: CUTOVER, totalCents: totalOf(i), warnings: [] });
    const id = res.json().id as string;
    expect(journal(id)).toEqual([
      '2310 Cr 1,701.15 Cy Buwan',
      '2401 Cr 2,110.00 Ana Araw',
      '2401 Cr 2,280.00 Ben Halo',
      '2402 Cr 717.30 Ana Araw',
      '2403 Cr 400.00 Ana Araw',
      '2404 Cr 500.00 Ben Halo',
      '2405 Cr 300.00 Ben Halo',
      `3900 Dr ${formatPesos(totalOf(i))}`,
    ]);

    // Stored per employee; the form input comes back as typed; round-trips through load/toInput.
    expect(env.db.prepare('SELECT month, total_cents FROM stat_openings WHERE document_id = ?').get(id)).toMatchObject({ month: '2026-08', total_cents: totalOf(i) });
    expect(env.db.prepare('SELECT COUNT(*) FROM stat_opening_lines WHERE document_id = ?').pluck().get(id)).toBe(3);
    expect((await accountant.get(`/api/docs/stat.opening/${id}`)).json().input).toEqual(i);
    expect(openingStatDoc.toInput(openingStatDoc.load(env.db, id))).toEqual(i);

    // The month's payable per scheme, read from the ledger, matches what was recorded.
    expect(schemeCheck(env.db, 'SSS', '2026-08')).toMatchObject({ recordedCents: 439_000, remittedCents: 0, balanceCents: 439_000 });
    expect(schemeCheck(env.db, 'PHIC', '2026-08')).toMatchObject({ recordedCents: 71_730, balanceCents: 71_730 });
    expect(schemeCheck(env.db, 'HDMF', '2026-08')).toMatchObject({ recordedCents: 40_000, balanceCents: 40_000 });
    expect(schemeCheck(env.db, 'WTAX', '2026-08')).toMatchObject({ recordedCents: 170_115, balanceCents: 170_115 });
    expect(payableByEmployee(env.db, 'SSS', '2026-08').get(ana)).toBe(211_000);
    expect(payableByEmployee(env.db, 'SSS', '2026-08').get(ben)).toBe(228_000);
    noBrokenInvariants();
  });

  it('a remittance after the cut-over paying it exactly, with the variance check clean', async () => {
    await setCutover();
    await open(input());

    // SSS: Ana 2,110.00 + Ben 2,280.00 = 4,390.00; PhilHealth: Ana 717.30; paid to the peso, in full.
    const sss = await accountant.post('/api/docs/stat.remittance/post', { input: { scheme: 'SSS', month: '2026-08', cashPlaceId: BDO, amountCents: 439_000, reference: 'PRN 0826-0001' }, expectedTotalCents: 439_000 }, idem());
    expect(sss.statusCode).toBe(200);
    expect(journal(sss.json().id)).toEqual(['1111 Cr 4,390.00', '2401 Dr 2,110.00 Ana Araw', '2401 Dr 2,280.00 Ben Halo']);
    expect(schemeCheck(env.db, 'SSS', '2026-08')).toMatchObject({ recordedCents: 439_000, remittedCents: 439_000, balanceCents: 0, overRemitted: [] });

    const phic = await accountant.post('/api/docs/stat.remittance/post', { input: { scheme: 'PHIC', month: '2026-08', cashPlaceId: BDO, amountCents: 71_730, reference: 'PRN 0826-0002' }, expectedTotalCents: 71_730 }, idem());
    expect(phic.json().warnings).toEqual([]);
    expect(schemeCheck(env.db, 'PHIC', '2026-08')).toMatchObject({ recordedCents: 71_730, remittedCents: 71_730, balanceCents: 0 });

    // Withholding tax and Pag-IBIG, same story.
    await accountant.post('/api/docs/stat.remittance/post', { input: { scheme: 'HDMF', month: '2026-08', cashPlaceId: BDO, amountCents: 40_000, reference: 'PRN 0826-0003' }, expectedTotalCents: 40_000 }, idem());
    const tax = await accountant.post('/api/docs/stat.remittance/post', { input: { scheme: 'WTAX', month: '2026-08', cashPlaceId: BDO, amountCents: 170_115, reference: 'eFPS 0826-0004' }, expectedTotalCents: 170_115 }, idem());
    expect(journal(tax.json().id)).toEqual(['1111 Cr 1,701.15', '2310 Dr 1,701.15 Cy Buwan']);

    // Nothing at all is left to remit for the month; the loan amortizations opened here have no remittance document yet.
    for (const scheme of ['SSS', 'PHIC', 'HDMF', 'WTAX'] as const) expect(schemeCheck(env.db, scheme, '2026-08').balanceCents).toBe(0);
    noBrokenInvariants();
  });

  it('two months: each scheme check and list stays with its own month', async () => {
    await setCutover();
    const augId = (await open(input({ month: '2026-08' }))).json().id as string;
    const julId = (await open(input({ month: '2026-07', employees: [{ employeeId: ana, sssCents: 100_000 }] }))).json().id as string;
    expect(augId).not.toBe(julId);

    expect(schemeCheck(env.db, 'SSS', '2026-08').recordedCents).toBe(439_000);
    expect(schemeCheck(env.db, 'SSS', '2026-07').recordedCents).toBe(100_000);
    expect((await accountant.get('/api/stat/months')).json().map((m: { month: string }) => m.month)).toEqual(['2026-08', '2026-07']);
    expect(statMonths(env.db)).toEqual(['2026-08', '2026-07']);
    noBrokenInvariants();
  });

  it('a cancel lands on the cut-over date, only once no remittance stands on a scheme it credited', async () => {
    await setCutover();
    const id = (await open(input({ employees: [{ employeeId: ana, sssCents: 211_000 }, { employeeId: ben, phicCents: 50_000 }] }))).json().id as string;
    env.clock.advance(3 * 24 * 3600_000); // cancelled days later, 2026-10-01
    accountant = await env.as('accountant'); // the session pinned at 2026-09-28 has expired

    // A remittance stands on SSS for the month: blocked, naming it.
    const rem = (await accountant.post('/api/docs/stat.remittance/post', { input: { scheme: 'SSS', month: '2026-08', cashPlaceId: BDO, amountCents: 211_000, reference: 'PRN 0826-0001' }, expectedTotalCents: 211_000 }, idem())).json();
    const blocked = await cancel(accountant, 'stat.opening', id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: `Cancel these first: ${rem.number}.` });

    // Once the remittance is cancelled, the opening cancels too, mirrored on the cut-over date (not the cancel day).
    expect((await cancel(accountant, 'stat.remittance', rem.id)).statusCode).toBe(200);
    const ok = await cancel(accountant, 'stat.opening', id);
    expect(ok.statusCode).toBe(200);
    expect(journal(id, 'reversal')).toEqual(['2401 Dr 2,110.00 Ana Araw', '2402 Dr 500.00 Ben Halo', '3900 Cr 2,610.00']);
    expect(env.db.prepare(`SELECT business_date FROM journals WHERE source_type = 'document' AND source_id = ? AND posting_kind = 'reversal'`).pluck().all(id)).toEqual([CUTOVER]);
    expect(schemeCheck(env.db, 'SSS', '2026-08')).toMatchObject({ recordedCents: 0, balanceCents: 0 });
    noBrokenInvariants();
  });
});

describe('refusals', () => {
  it('without a cut-over date, on another date, once the opening is closed, a month after the cut-over, and a second one for the same month', async () => {
    expect(await errors(input())).toEqual(['NO_CUTOVER']);
    await setCutover();
    expect(await errors(input(), null)).toEqual(['NOT_CUTOVER_DATE']); // today, 2026-09-28
    expect(await errors(input(), '2026-09-20')).toEqual(['NOT_CUTOVER_DATE']);
    expect((await open(input(), '2026-09-29')).json().code).toBe('BAD_DATE'); // never a future date (NR-7)

    expect(await errors(input({ month: '2026-10' }))).toEqual(['MONTH_AFTER_CUTOVER']);
    expect(await errors(input({ month: '2026-09' }))).toEqual([]); // the cut-over month itself is fine

    expect(await errors(input())).toEqual([]);
    const first = (await open(input())).json().id as string;
    expect(await errors(input())).toEqual(['MONTH_TAKEN']);
    expect(await errors(input({ month: '2026-07' }))).toEqual([]);

    // Nothing may stay posted for the close to succeed (3900 must net to zero, PLAN D8 step 4).
    expect((await cancel(accountant, 'stat.opening', first)).statusCode).toBe(200);
    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200);
    const closed = await open(input({ month: '2026-06' }));
    expect(closed.statusCode).toBe(422);
    expect(closed.json().details.map((i: { code: string }) => i.code)).toEqual(['OPENING_CLOSED']);
  });

  it('a duplicate employee, an inactive employee, and a line with nothing to remit', async () => {
    await setCutover();
    expect(await errors(input({ employees: [{ employeeId: ana, sssCents: 100 }, { employeeId: ana, phicCents: 100 }] }))).toEqual(['DUPLICATE_EMPLOYEE']);
    expect(await errors(input({ employees: [{ employeeId: ana }] }))).toEqual(['EMPTY_LINE']);
    env.db.prepare(`UPDATE emp_employees SET is_active = 0, separated_on = '2026-08-01', separation_reason = 'Made-up separation for tests' WHERE id = ?`).run(ana);
    expect(await errors(input({ employees: [{ employeeId: ana, sssCents: 100 }] }))).toEqual(['EMPLOYEE']);
  });

  it('who may record it', async () => {
    await setCutover();
    expect((await open(input(), CUTOVER, encoder)).statusCode).toBe(403);
    expect((await open(input(), CUTOVER, owner)).statusCode).toBe(403);
    expect((await owner.get('/api/docs/stat.opening')).statusCode).toBe(200);
    expect((await encoder.get('/api/docs/stat.opening')).statusCode).toBe(403);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random opening statutory payables post balanced, tie to the ledger per scheme and month, and cancel to zero', async () => {
    await setCutover();
    const perms = ['acc.opening.create', 'acc.opening.post', 'acc.opening.cancel', 'acc.backdate', 'stat.rem.create', 'stat.rem.post', 'stat.rem.cancel'];
    const actor = { userId: accountant.userId, permissions: new Set(perms) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: CUTOVER, at: stamp(env.clock), userId: actor.userId, can: () => true });
    const post = (i: OpeningStatInput) => postDocument(e, openingStatDoc, actor, { input: i, expectedTotalCents: totalOf(i), businessDate: CUTOVER });

    fc.assert(
      fc.property(fc.array(fc.tuple(openingStatDoc.arbitrary(env.db), fc.boolean()), { minLength: 1, maxLength: 8 }), (ops) => {
        for (const [i, cancelIt] of ops) {
          const doc = openingStatDoc.compute(i, ctx());
          const issues = openingStatDoc.validate(doc, ctx());
          const errs = issues.filter((x) => x.level === 'error').map((x) => x.code);
          if (errs.length) {
            expect(errs).toEqual(['MONTH_TAKEN']); // the only collision random months can cause here
            continue;
          }
          const lines = resolveDraft(env.db, openingStatDoc.journal!(doc, ctx())!);
          expect(lines.reduce((s, l) => s + (l.debitCents ?? 0), 0)).toBe(lines.reduce((s, l) => s + (l.creditCents ?? 0), 0));
          const o = post(i);
          expect(openingStatDoc.load(env.db, o.id)).toEqual(doc);
          expect(openingStatDoc.toInput(openingStatDoc.load(env.db, o.id))).toEqual(i);
          if (cancelIt) {
            try {
              cancelDocument(e, openingStatDoc, actor, o.id, 'Recorded twice by mistake');
            } catch (x) {
              expect((x as AppError).code).toBe('HAS_DEPENDENTS'); // a remittance already stands on a scheme it credited
            }
          }
        }
        for (const month of statMonths(env.db)) {
          for (const scheme of ['SSS', 'PHIC', 'HDMF', 'WTAX'] as const) {
            const payable = [...payableByEmployee(env.db, scheme, month).values()];
            expect(schemeCheck(env.db, scheme, month).balanceCents).toBe(payable.reduce((s, x) => s + x, 0));
          }
        }
        noBrokenInvariants();
      }),
      { numRuns: 25 },
    );
  });
});
