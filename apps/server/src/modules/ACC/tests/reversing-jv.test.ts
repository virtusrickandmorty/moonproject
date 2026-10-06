/**
 * Reversing journal vouchers (PLAN E12, "reversal-on-date option for accruals"): a month-end accrual marked to reverse,
 * the "Reversals due" list from the first day of the next month, the prefilled reversal (lines mirrored to the centavo,
 * same parties, memo "Reversal of JV-…"), recorded by the accountant; reversed at most once; the cancel rules. Golden:
 * September rent accrued on 2026-09-30 and reversed on 2026-10-01. Made-up names only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { formatPesos } from '@moonproject/shared';
import { createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { firstOfNextMonth } from '../doctypes/jv-reversals.ts';

let env: TestEnv;
let accountant: Client, encoder: Client;
const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const goTo = async (date: string) => {
  env.clock.set(`${date}T02:00:00Z`);
  [accountant, encoder] = [await env.as('accountant'), await env.as('encoder')];
};

type Line = { accountId: number; party?: { type: string; id: string }; debitCents?: number; creditCents?: number; memo?: string };
type JvInput = { memo: string; lines: Line[]; reverseNextMonth?: boolean; reversalOf?: string; lateReason?: string };
const total = (i: JvInput) => i.lines.reduce((s, l) => s + (l.debitCents ?? 0), 0);
const preview = async (input: JvInput, businessDate?: string) => (await accountant.post('/api/docs/acc.jv/preview', { input, ...(businessDate ? { businessDate } : {}) })).json();
const post = (input: JvInput, businessDate?: string) =>
  accountant.post('/api/docs/acc.jv/post', { input, expectedTotalCents: total(input), ...(businessDate ? { businessDate } : {}) }, idem());
const record = async (input: JvInput, businessDate?: string) => {
  const res = await post(input, businessDate);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; number: string; businessDate: string; summary: string };
};
const cancel = (id: string) => accountant.post(`/api/docs/acc.jv/${id}/cancel`, { reason: 'Recorded against the wrong month' }, idem());
const due = async () => ((await accountant.get('/api/acc/jv/reversals-due')).json() as { number: string; reverseOn: string }[]).map((r) => `${r.number} ${r.reverseOn}`);
const reversal = async (id: string) => {
  const res = await accountant.get(`/api/acc/jv/${id}/reversal`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { businessDate: string; original: { number: string }; input: JvInput };
};
const errors = (issues: { code: string; level: string }[]) => issues.filter((i) => i.level === 'error').map((i) => i.code);

/** The document's journal: "2102 Cr 25,000.50 Sample Lessor 2026-09-30", in line order. */
function journal(documentId: string, kind: 'original' | 'reversal' = 'original'): string[] {
  const rows = env.db
    .prepare(
      `SELECT a.code, l.debit_cents AS dr, l.credit_cents AS cr, l.party_id AS party, j.business_date AS date FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY l.rowid`,
    )
    .all(documentId, kind) as { code: string; dr: number; cr: number; party: string | null; date: string }[];
  return rows.map((r) => `${r.code} ${r.dr ? 'Dr' : 'Cr'} ${formatPesos(r.dr || r.cr)}${r.party ? ` ${r.party}` : ''} ${r.date}`);
}
const sums = (documentId: string) =>
  env.db
    .prepare(`SELECT SUM(l.debit_cents) AS dr, SUM(l.credit_cents) AS cr FROM journal_lines l JOIN journals j ON j.id = l.journal_id WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = 'original'`)
    .get(documentId) as { dr: number; cr: number };
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

/** September rent and electricity accrued at month end, to the lessor and the utility (a free party on 2102). */
const accrual = (): JvInput => ({
  memo: 'Accrual of September rent and power',
  reverseNextMonth: true,
  lines: [
    { accountId: account('6110'), debitCents: 2_500_050, memo: 'September rent' },
    { accountId: account('6120'), debitCents: 812_337 },
    { accountId: account('2102'), party: { type: 'free', id: 'Sample Lessor' }, creditCents: 2_500_050, memo: 'Rent to pay' },
    { accountId: account('2102'), party: { type: 'free', id: 'Sample Power Co.' }, creditCents: 812_337 },
  ],
});

beforeEach(async () => {
  env = await createTestEnv('2026-09-30T02:00:00Z'); encoderOwnDefaults(env);
  await goTo('2026-09-30');
});

describe('reversing journal vouchers (E12)', () => {
  it('golden: a month-end accrual and its reversal on the first day of the next month, mirrored to the centavo', async () => {
    const pre = await preview(accrual());
    expect(pre.summary).toBe('This will record a journal voucher of ₱33,123.87 over 4 lines: Accrual of September rent and power. It is to be reversed on 2026-10-01.');
    const jv = await record(accrual());
    expect(journal(jv.id)).toEqual([
      '6110 Dr 25,000.50 2026-09-30',
      '6120 Dr 8,123.37 2026-09-30',
      '2102 Cr 25,000.50 Sample Lessor 2026-09-30',
      '2102 Cr 8,123.37 Sample Power Co. 2026-09-30',
    ]);
    expect((await accountant.get(`/api/docs/acc.jv/${jv.id}`)).json().doc).toMatchObject({ reverseOn: '2026-10-01', reverseNextMonth: true, reverses: null });

    // Not due on the accrual's own month; due from the first day of the next.
    expect(await due()).toEqual([]);
    expect((await accountant.get(`/api/acc/jv/${jv.id}/reversal`)).json().code).toBe('NOT_DUE');
    await goTo('2026-10-03');
    expect(await due()).toEqual([`${jv.number} 2026-10-01`]);
    expect((await encoder.get('/api/acc/jv/reversals-due')).statusCode).toBe(403);

    // The one button: same lines, debits and credits swapped, same parties and line memos, dated that first day.
    const r = await reversal(jv.id);
    expect(r.businessDate).toBe('2026-10-01');
    expect(r.input).toEqual({
      memo: `Reversal of ${jv.number}`,
      reversalOf: jv.id,
      lines: [
        { accountId: account('6110'), creditCents: 2_500_050, memo: 'September rent' },
        { accountId: account('6120'), creditCents: 812_337 },
        { accountId: account('2102'), party: { type: 'free', id: 'Sample Lessor' }, debitCents: 2_500_050, memo: 'Rent to pay' },
        { accountId: account('2102'), party: { type: 'free', id: 'Sample Power Co.' }, debitCents: 812_337 },
      ],
    });
    // Recorded like any JV; dated its reversal day, it is not a late entry and needs no late reason.
    const rp = await preview(r.input, r.businessDate);
    expect(errors(rp.issues)).toEqual([]);
    expect(rp.issues.map((i: { code: string }) => i.code)).not.toContain('LATE_ENTRY');
    const rev = await record(r.input, r.businessDate);
    expect(rev.businessDate).toBe('2026-10-01');
    expect(rev.summary).toBe(`This will record a journal voucher of ₱33,123.87 over 4 lines: Reversal of ${jv.number}. It reverses ${jv.number}.`);
    expect(journal(rev.id)).toEqual([
      '6110 Cr 25,000.50 2026-10-01',
      '6120 Cr 8,123.37 2026-10-01',
      '2102 Dr 25,000.50 Sample Lessor 2026-10-01',
      '2102 Dr 8,123.37 Sample Power Co. 2026-10-01',
    ]);
    expect(sums(rev.id)).toEqual({ dr: 3_312_387, cr: 3_312_387 });
    // Together they net to zero on every account and party.
    const net = env.db
      .prepare(
        `SELECT a.code, COALESCE(l.party_id, '') AS party, SUM(l.debit_cents - l.credit_cents) AS net FROM journal_lines l JOIN journals j ON j.id = l.journal_id
         JOIN accounts a ON a.id = l.account_id WHERE j.source_id IN (?, ?) GROUP BY 1, 2 HAVING net <> 0`,
      )
      .all(jv.id, rev.id);
    expect(net).toEqual([]);
    expect((await accountant.get(`/api/docs/acc.jv/${rev.id}`)).json().doc).toMatchObject({ reverses: { number: jv.number, reverseOn: '2026-10-01' }, isLate: false });
    expect((await accountant.get(`/api/docs/acc.jv/${jv.id}`)).json().doc.reversedBy).toEqual({ documentId: rev.id, number: rev.number });
    expect(await due()).toEqual([]);
    noBrokenInvariants();
  });

  it('reversed at most once; cancelling the reversal lets it be reversed again; the original is not cancelled while its reversal stands', async () => {
    const jv = await record(accrual());
    await goTo('2026-10-01');
    const r = await reversal(jv.id);
    const first = await record(r.input);

    // Once reversed: no second reversal, from the button or typed.
    const again = await accountant.get(`/api/acc/jv/${jv.id}/reversal`);
    expect([again.statusCode, again.json().message]).toEqual([409, `${jv.number} is already reversed by ${first.number}. Cancel that one first to reverse it again.`]);
    expect(errors((await preview(r.input)).issues)).toEqual(['REVERSED']);
    expect((await post(r.input)).statusCode).toBe(422);

    // The original stands while its reversal does: the refusal names the reversal.
    const refused = await cancel(jv.id);
    expect([refused.statusCode, refused.json().code, refused.json().message]).toEqual([409, 'HAS_DEPENDENTS', `Cancel these first: ${first.number}.`]);

    // Cancelling the reversal puts the original back in the list, and it can be reversed again.
    expect((await cancel(first.id)).statusCode).toBe(200);
    expect(await due()).toEqual([`${jv.number} 2026-10-01`]);
    const second = await record((await reversal(jv.id)).input);
    expect(second.number).not.toBe(first.number);
    expect(await due()).toEqual([]);

    // With that reversal cancelled too, the original may be cancelled, and it leaves the list.
    expect((await cancel(second.id)).statusCode).toBe(200);
    expect((await cancel(jv.id)).statusCode).toBe(200);
    expect(await due()).toEqual([]);
    expect(errors((await preview(r.input)).issues)).toEqual(['ORIGINAL_CANCELLED']);
    noBrokenInvariants();
  });

  it('a reversal mirrors its original on its reversal day, and only a JV marked to reverse is reversed', async () => {
    const jv = await record(accrual());
    const plain = await record({ ...accrual(), reverseNextMonth: undefined, memo: 'Rent paid ahead' });
    await goTo('2026-10-05');
    const r = await reversal(jv.id);

    // Another day: the reversal is dated the first day of the month after the original.
    expect(errors((await preview(r.input)).issues)).toEqual(['REVERSAL_DATE']);
    expect(errors((await preview(r.input, '2026-10-02')).issues)).toEqual(['REVERSAL_DATE', 'LATE_REASON']); // and on another past day, a late entry
    // Other amounts, accounts or parties: not a mirror.
    const lines = r.input.lines.map((l) => ({ ...l }));
    lines[0] = { ...lines[0]!, creditCents: 2_500_049 };
    lines[2] = { ...lines[2]!, debitCents: 2_500_049 };
    expect(errors((await preview({ ...r.input, lines }, r.businessDate)).issues)).toEqual(['NOT_MIRROR']);
    const party = r.input.lines.map((l, i) => (i === 3 ? { ...l, party: { type: 'free', id: 'Another Power Co.' } } : l));
    expect(errors((await preview({ ...r.input, lines: party }, r.businessDate)).issues)).toEqual(['NOT_MIRROR']);
    // The same lines in another order are still its mirror.
    expect(errors((await preview({ ...r.input, lines: [...r.input.lines].reverse() }, r.businessDate)).issues)).toEqual([]);
    // A reversal is not itself reversed; a JV not marked to reverse has no reversal (and its date is then a late entry's).
    expect(errors((await preview({ ...r.input, reverseNextMonth: true }, r.businessDate)).issues)).toEqual(['REVERSAL_REVERSING']);
    expect((await accountant.get(`/api/acc/jv/${plain.id}/reversal`)).json().code).toBe('NOT_REVERSING');
    expect(errors((await preview({ ...r.input, reversalOf: plain.id }, r.businessDate)).issues)).toEqual(['NOT_REVERSING', 'LATE_REASON']);
    expect(errors((await preview({ ...r.input, reversalOf: 'not-a-voucher' }, r.businessDate)).issues)).toEqual(['REVERSAL_OF', 'LATE_REASON']);
    expect(await due()).toEqual([`${jv.number} 2026-10-01`]);
  });

  it('the reversal day is the first day of the next month, across the year end', () => {
    expect(['2026-09-30', '2026-09-01', '2026-12-31', '2027-01-15', '2028-02-29'].map(firstOfNextMonth)).toEqual(['2026-10-01', '2026-10-01', '2027-01-01', '2027-02-01', '2028-03-01']);
  });
});
