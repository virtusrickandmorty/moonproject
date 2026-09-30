/**
 * An opening row typed twice (PLAN D8 "Cut-over"): each opening document type warns, code DUPLICATE_OPENING, when a
 * posted, not cancelled document of its own type already records the same key figures, and names that document.
 * A warning only: the second row still records when the person goes on. One key figure different, or the first row
 * cancelled, gives none.
 *   OB- cash place and amount; loan lender and principal; asset description, acquired date and cost;
 *   cash advance employee and amount; officer balance officer and amount; 2307 customer, quarter and amount.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { addEmployee } from '../../EMP/tests/fixture.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

const CUTOVER = '2026-09-27'; // the day before the test clock's 2026-09-28
const REPEAT = 'Record it again only if there really are two.';

interface World {
  env: TestEnv;
  ana: string;
  carla: string;
  officerA: string;
  officerB: string;
  customers: ReturnType<typeof seedCustomers>;
}
type Input = Record<string, unknown>;
interface Case {
  type: string;
  first: string; // the number of the first document of its kind
  base: (w: World) => Input;
  total: (input: Input) => number;
  /** One key figure different at a time. */
  differs: [string, (w: World, base: Input) => Input][];
  /** The message the second, identical row gets (a RegExp where the name comes from the fixtures). */
  message: (w: World) => string | RegExp;
}

const accountId = (w: World, code: string) => w.env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const accountName = (w: World, code: string) => w.env.db.prepare('SELECT name FROM accounts WHERE code = ?').pluck().get(code) as string;
const say = (first: string, what: string) => `${first} already records ${what}. ${REPEAT}`;

type Row = { customerId: string; year: number; quarter: number; atc: string; cwtCents: number; vatWithheldCents: number; certificate: string };
const row = (w: World): Row => ({ customerId: w.customers.school, year: 2026, quarter: 2, atc: 'WC158', cwtCents: 100_000, vatWithheldCents: 500_000, certificate: 'received' });

const CASES: Case[] = [
  {
    type: 'acc.opening',
    first: 'OB-000001',
    base: (w) => ({ lines: [{ accountId: accountId(w, '1101'), debitCents: 9_968_000 }] }),
    total: (i) => (i.lines as { debitCents: number }[]).reduce((s, l) => s + l.debitCents, 0),
    differs: [
      ['the cash place', (w) => ({ lines: [{ accountId: accountId(w, '1111'), debitCents: 9_968_000 }] })],
      ['the amount', (w) => ({ lines: [{ accountId: accountId(w, '1101'), debitCents: 9_968_100 }] })],
    ],
    message: (w) => say('OB-000001', `₱99,680.00 in ${accountName(w, '1101')} (1101)`),
  },
  {
    type: 'loan.opening',
    first: 'OBLN-000001',
    base: () => ({
      lender: 'Sample Investor A', kind: 'loan', originalPrincipalCents: 60_000_000, dateReceived: '2025-11-10', principalCents: 50_000_000,
      interestRateBp: 1200, monthsLeft: 13, schedule: 'declining', nextDueDate: '2026-10-15', reference: 'PN 2025-011',
    }),
    total: (i) => i.principalCents as number,
    differs: [
      ['the lender', (_w, b) => ({ ...b, lender: 'Sample Investor B' })],
      ['the principal', (_w, b) => ({ ...b, principalCents: 40_000_000 })],
    ],
    message: () => say('OBLN-000001', 'this loan (Sample Investor A, ₱500,000.00 still owed)'),
  },
  {
    type: 'fa.opening',
    first: 'OBFA-000001',
    base: () => ({
      classCode: 'machinery', description: 'Embroidery machine', acquiredOn: '2024-11-05', costCents: 30_000_000, residualCents: 3_000_000, lifeMonths: 60, accumulatedCents: 10_800_000,
    }),
    total: (i) => i.costCents as number,
    differs: [
      ['the description', (_w, b) => ({ ...b, description: 'Heat press' })],
      ['the acquired date', (_w, b) => ({ ...b, acquiredOn: '2024-11-06' })],
      ['the cost', (_w, b) => ({ ...b, costCents: 30_100_000 })],
    ],
    message: () => say('OBFA-000001', 'this asset (Embroidery machine, 2024-11-05, ₱300,000.00)'),
  },
  {
    type: 'ca.opening',
    first: 'OBCA-000001',
    base: (w) => ({ employeeId: w.ana, owedCents: 200_000, installmentCents: 100_000, note: 'Old CA-0098, CA-0102 from the prior book' }),
    total: (i) => i.owedCents as number,
    differs: [
      ['the employee', (w, b) => ({ ...b, employeeId: w.carla })],
      ['the amount', (_w, b) => ({ ...b, owedCents: 300_000 })],
    ],
    message: () => say('OBCA-000001', 'this cash advance (Ana Sample, ₱2,000.00)'),
  },
  {
    type: 'eq.opening',
    first: 'OBOF-000001',
    base: (w) => ({ personId: w.officerA, direction: 'owes_shop', amountCents: 1_500_000, note: 'Old officer ledger: withdrawn by the officer' }),
    total: (i) => i.amountCents as number,
    differs: [
      ['the officer', (w, b) => ({ ...b, personId: w.officerB })],
      ['the amount', (_w, b) => ({ ...b, amountCents: 1_600_000 })],
    ],
    message: () => say('OBOF-000001', 'this officer balance (Sample Officer A, ₱15,000.00)'),
  },
  {
    type: 'tax.opening',
    first: 'OBWT-000001',
    base: (w) => ({ rows: [row(w)] }),
    total: (i) => (i.rows as Row[]).reduce((s, r) => s + r.cwtCents + r.vatWithheldCents, 0),
    differs: [
      ['the customer', (w) => ({ rows: [{ ...row(w), customerId: w.customers.other }] })],
      ['the quarter', (w) => ({ rows: [{ ...row(w), quarter: 1 }] })],
      ['the amount', (w) => ({ rows: [{ ...row(w), cwtCents: 110_000 }] })],
    ],
    message: () => /^OBWT-000001 already records this 2307 \(.+, Q2 2026, ₱6,000\.00\)\. Record it again only if there really are two\.$/,
  },
];

let w: World;
let accountant: Client;

beforeEach(async () => {
  const env = await createTestEnv(); // 2026-09-28 10:00 Manila
  accountant = await env.as('accountant');
  const encoder = await env.as('encoder');
  const person = async (name: string) =>
    (await accountant.post('/api/eq/people', { name, isStockholder: true, isOfficer: true, position: 'Officer' })).json().id as string;
  w = {
    env,
    ana: addEmployee(env.db, 'Ana Sample', {}),
    carla: addEmployee(env.db, 'Carla Sample', {}),
    officerA: await person('Sample Officer A'),
    officerB: await person('Sample Officer B'),
    customers: seedCustomers(env.db, encoder.userId),
  };
  await accountant.post('/api/auth/step-up', { password: PASSWORD });
  expect((await accountant.post('/api/acc/opening/cutover-date', { date: CUTOVER })).statusCode).toBe(200);
});

const preview = async (type: string, input: Input) => (await accountant.post(`/api/docs/${type}/preview`, { input, businessDate: CUTOVER })).json();
const record = (c: Case, input: Input) =>
  accountant.post(`/api/docs/${c.type}/post`, { input, expectedTotalCents: c.total(input), businessDate: CUTOVER }, idem());
const duplicates = (issues: { code: string; level: string; message: string }[]) => issues.filter((i) => i.code === 'DUPLICATE_OPENING');
const posted = (type: string) => w.env.db.prepare(`SELECT number FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];

describe.each(CASES)('$type typed twice', (c) => {
  it('the first row gets no warning; the second identical row gets one that names the first, and still records when the person proceeds', async () => {
    const input = c.base(w);
    expect(duplicates((await preview(c.type, input)).issues)).toEqual([]);
    const first = await record(c, input);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ number: c.first });
    expect(duplicates(first.json().warnings)).toEqual([]);

    const again = duplicates((await preview(c.type, input)).issues);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ code: 'DUPLICATE_OPENING', level: 'warning' });
    const expected = c.message(w);
    if (typeof expected === 'string') expect(again[0]!.message).toBe(expected);
    else expect(again[0]!.message).toMatch(expected);

    // A new Idempotency-Key is a new attempt: the warning does not block it.
    const second = await record(c, input);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().number).not.toBe(c.first);
    expect(duplicates(second.json().warnings)).toHaveLength(1);
    expect(posted(c.type)).toHaveLength(2);
    expect(runInvariants(w.env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it.each(c.differs.map(([what, make]) => [what, make] as const))('a row that differs in %s gets none', async (_what, make) => {
    const input = c.base(w);
    expect((await record(c, input)).statusCode).toBe(200);
    const other = make(w, input);
    expect(duplicates((await preview(c.type, other)).issues)).toEqual([]);
    const second = await record(c, other);
    expect(second.statusCode, second.body).toBe(200);
    expect(duplicates(second.json().warnings)).toEqual([]);
  });

  it('a cancelled first row gives none', async () => {
    const input = c.base(w);
    const first = await record(c, input);
    expect(first.statusCode, first.body).toBe(200);
    const cancel = await accountant.post(`/api/docs/${c.type}/${first.json().id}/cancel`, { reason: 'Recorded by mistake at cut-over' }, idem());
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(duplicates((await preview(c.type, input)).issues)).toEqual([]);
    const second = await record(c, input);
    expect(second.statusCode, second.body).toBe(200);
    expect(duplicates(second.json().warnings)).toEqual([]);
  });
});

describe('what the check leaves alone', () => {
  it('an OB- line on an account that is not a cash place is not compared', async () => {
    const stock = { lines: [{ accountId: accountId(w, '1301'), debitCents: 39_135_000 }] };
    const rec = () => accountant.post('/api/docs/acc.opening/post', { input: stock, expectedTotalCents: 39_135_000, businessDate: CUTOVER }, idem());
    expect((await rec()).statusCode).toBe(200);
    expect(duplicates((await preview('acc.opening', stock)).issues)).toEqual([]);
  });

  it('editing a row (cancel and reissue) does not warn about the row it replaces', async () => {
    const c = CASES.find((x) => x.type === 'fa.opening')!;
    const input = c.base(w);
    const first = await record(c, input);
    const edited = { ...input, location: 'Production floor' };
    const r = await accountant.post(
      `/api/docs/${c.type}/${first.json().id}/reissue`,
      { input: edited, expectedTotalCents: c.total(edited), reason: 'Added the location of the machine', businessDate: CUTOVER },
      idem(),
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(duplicates(r.json().warnings)).toEqual([]);
  });
});
