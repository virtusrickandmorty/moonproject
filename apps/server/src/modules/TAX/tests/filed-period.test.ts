/**
 * Filed periods (ACC-09, ACC-22): once a return's payment is recorded (and not cancelled), recording or cancelling a
 * document dated in its period warns FILED_PERIOD, in the preview before Record and before Cancel, and never blocks.
 * One scenario per return kind: 0619-E (a month), 1601-EQ (a quarter), 2550Q (a quarter and its VAT close), 1702Q (a
 * quarter), 1702 (a year) and the 1601-C a withholding-tax remittance pays (a month). No warning once that payment is
 * cancelled, none outside the period. The "changes after filing" report lists exactly the late changes. Made-up names.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, PASSWORD, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { cancelDocument, postDocument, previewCancel, previewDocument } from '../../../engine/documents/lifecycle.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jvDoc } from '../../ACC/doctypes/jv.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { world } from '../../PAY/tests/world.ts';
import { remittanceDoc } from '../../STAT/doctypes/remittance.ts';
import { dueOf } from '../../STAT/ledger.ts';
import { filedReturnsCovering } from '../public.ts';
import { today as manilaToday } from '../../../platform/clock.ts';

let env: TestEnv;
let accountant: Client, owner: Client, encoder: Client;
let BDO: number, customer: string, supplier: string;

const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const today = () => manilaToday(env.clock);
const goTo = async (date: string) => {
  env.clock.set(`${date}T02:00:00Z`);
  [accountant, owner, encoder] = [await env.as('accountant'), await env.as('owner'), await env.as('encoder')];
};
type Issue = { code: string; level: string; message: string };
const ok = (res: { statusCode: number; body: string; json(): unknown }) => (expect(res.statusCode, res.body).toBe(200), res.json() as { id: string; number: string; warnings: Issue[] });
const dated = (businessDate?: string) => (businessDate && businessDate !== today() ? { businessDate } : {});

/** A journal voucher: [account code, debit (+) or credit (−), party]; backdated with a late reason. */
const jvInput = (memo: string, lines: [string, number, { type: string; id: string }?][], businessDate?: string) => ({
  memo,
  lines: lines.map(([code, cents, party]) => ({ accountId: account(code), ...(party ? { party } : {}), ...(cents > 0 ? { debitCents: cents } : { creditCents: -cents }) })),
  ...(businessDate && businessDate < today() ? { lateReason: 'Found in the month-end review' } : {}),
});
const jv = async (memo: string, lines: [string, number, { type: string; id: string }?][], businessDate?: string) =>
  ok(await accountant.post('/api/docs/acc.jv/post', { input: jvInput(memo, lines, businessDate), expectedTotalCents: lines.filter(([, c]) => c > 0).reduce((s, [, c]) => s + c, 0), ...dated(businessDate) }, idem()));
/** A small expense JV dated `businessDate`: what the accountant would record in a filed month. */
const probe = (businessDate?: string) => jvInput('Bank charge found late', [['6190', 5_000], ['1111', -5_000]], businessDate);

const preview = async (type: string, input: unknown, businessDate?: string) =>
  (await accountant.post(`/api/docs/${type}/preview`, { input, ...dated(businessDate) })).json() as { totalCents: number; issues: Issue[] };
const record = async (type: string, input: unknown, businessDate?: string) =>
  ok(await accountant.post(`/api/docs/${type}/post`, { input, expectedTotalCents: (await preview(type, input, businessDate)).totalCents, ...dated(businessDate) }, idem()));
const pay = (form: string, period: string, amountCents: number, extra: object = {}) =>
  record('tax.bir_payment', { form, period, cashPlaceId: BDO, amountCents, reference: `eFPS ${form} ${period}`, ...extra });
const cancel = (type: string, id: string) => accountant.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded against the wrong period' }, idem());

const filed = (issues: Issue[]) => issues.filter((i) => i.code === 'FILED_PERIOD');
/** The FILED_PERIOD message of a JV dated `businessDate`, in its preview before Record; '' if none. */
const onRecord = async (businessDate?: string) => {
  const w = filed((await preview('acc.jv', probe(businessDate), businessDate)).issues);
  expect(w.every((i) => i.level === 'warning')).toBe(true);
  return w.map((i) => i.message).join('\n');
};
/** The FILED_PERIOD message in the preview before Cancel; '' if none. */
const onCancel = async (type: string, id: string) => {
  const res = await accountant.get(`/api/docs/${type}/${id}/cancel-preview`);
  expect(res.statusCode, res.body).toBe(200);
  return filed(res.json().issues).map((i: Issue) => i.message).join('\n');
};
const recording = (named: string) => `${named} Recording this changes figures already filed; tell the accountant, who may need to amend the return.`;
const cancelling = (named: string) =>
  `${named} Cancelling this changes figures already filed (its reversal is dated the day it is cancelled, but the filed return still shows the original); tell the accountant, who may need to amend the return.`;

beforeEach(async () => {
  env = await createTestEnv('2026-07-01T02:00:00Z');
  await goTo('2026-07-01');
  BDO = cashPlaceId(env.db, '1111');
  customer = seedCustomers(env.db, encoder.userId).school;
  supplier = (await accountant.post('/api/pur/suppliers', { name: 'Sample Lessor', registeredName: 'Sample Lessor Corp.', tin: '333-444-555-000', isVatRegistered: true, ewtClass: 'rent_5' })).json().id;
});

/** July rent: ₱10,000.00 with ₱500.00 EWT withheld for the lessor. */
const julyRent = () => jv('July rent', [['6110', 1_000_000], ['2311', -50_000, { type: 'supplier', id: supplier }], ['1111', -950_000]]);

describe('the filed-period warning (ACC-09, ACC-22)', () => {
  it('0619-E (a month): on record and on cancel, in every preview, never blocking; gone once its payment is cancelled', async () => {
    const rent = await julyRent();
    expect(await onRecord('2026-07-01')).toBe(''); // nothing filed yet
    await goTo('2026-08-10');
    const p = await pay('0619-E', '2026-07', 50_000);
    const named = `The 0619-E for July 2026 was paid on ${p.number}, recorded 2026-08-10.`;
    expect(filedReturnsCovering(env.db, '2026-07-31')).toMatchObject([{ form: '0619-E', period: '2026-07', label: 'July 2026', payment: { number: p.number, paidOn: '2026-08-10' } }]);
    expect(filedReturnsCovering(env.db, '2026-08-01')).toEqual([]);

    expect(await onRecord('2026-07-01')).toBe(recording(named));
    expect(await onRecord('2026-07-31')).toBe(recording(named));
    expect(await onRecord('2026-06-30')).toBe('');
    expect(await onRecord('2026-08-01')).toBe('');
    expect(await onCancel('acc.jv', rent.id)).toBe(cancelling(named));
    // The payment's own cancel does not warn about the return it filed.
    expect(await onCancel('tax.bir_payment', p.id)).toBe('');

    // It never blocks: the record and the cancel go through, and say it again.
    const late = await jv('Bank charge found late', [['6190', 5_000], ['1111', -5_000]], '2026-07-25');
    expect(filed(late.warnings).map((i) => i.message)).toEqual([recording(named)]);
    const cancelled = ok(await cancel('acc.jv', late.id)) as unknown as { warnings: Issue[] };
    expect(filed(cancelled.warnings).map((i) => i.message)).toEqual([cancelling(named)]);

    // Once its payment is cancelled, the month is not filed any more.
    ok(await cancel('tax.bir_payment', p.id));
    expect(await onRecord('2026-07-20')).toBe('');
    expect(await onCancel('acc.jv', rent.id)).toBe('');
    expect(filedReturnsCovering(env.db, '2026-07-20')).toEqual([]);
  });

  it('1601-EQ (a quarter)', async () => {
    const rent = await julyRent();
    await goTo('2026-10-12');
    const p = await pay('1601-EQ', '2026-Q3', 50_000);
    const named = `The 1601-EQ for July to September 2026 was paid on ${p.number}, recorded 2026-10-12.`;
    expect(await onRecord('2026-07-01')).toBe(recording(named));
    expect(await onRecord('2026-09-30')).toBe(recording(named));
    expect(await onRecord('2026-10-01')).toBe('');
    expect(await onRecord('2026-06-30')).toBe('');
    expect(await onCancel('acc.jv', rent.id)).toBe(cancelling(named));
    ok(await cancel('tax.bir_payment', p.id));
    expect(await onRecord('2026-08-15')).toBe('');
    expect(await onCancel('acc.jv', rent.id)).toBe('');
  });

  it('2550Q (a quarter, and its VAT close whatever its date); a return paid in two parts is filed by the first', async () => {
    const sale = await jv('Sale on account', [['1111', 1_120_000], ['4101', -1_000_000, { type: 'customer', id: customer }], ['2301', -120_000, { type: 'customer', id: customer }]]);
    await goTo('2026-10-05');
    const close = await record('tax.vat_close', { year: 2026, quarter: 3 });
    expect(await onCancel('tax.vat_close', close.id)).toBe(''); // not filed yet
    const first = await pay('2550Q', '2026-Q3', 20_000);
    const second = await pay('2550Q', '2026-Q3', 100_000);
    const named = `The 2550Q for July to September 2026 was paid on ${first.number}, recorded 2026-10-05.`;
    expect(await onRecord('2026-08-31')).toBe(recording(named));
    expect(await onRecord('2026-10-01')).toBe('');
    expect(await onCancel('acc.jv', sale.id)).toBe(cancelling(named));
    // The VAT close is dated after the quarter, and the 2550Q covers it.
    expect(await onCancel('tax.vat_close', close.id)).toBe(cancelling(named));
    // Recording a second payment dated after the quarter warns about nothing, the first one included.
    expect(filed(second.warnings)).toEqual([]);
    // Its second payment is dated after the quarter: no warning on its own cancel.
    expect(await onCancel('tax.bir_payment', second.id)).toBe('');
    // With the first payment cancelled, the second one files it.
    ok(await cancel('tax.bir_payment', first.id));
    expect(await onRecord('2026-08-31')).toBe(recording(`The 2550Q for July to September 2026 was paid on ${second.number}, recorded 2026-10-05.`));
    ok(await cancel('tax.bir_payment', second.id));
    expect(await onRecord('2026-08-31')).toBe('');
    expect(await onCancel('tax.vat_close', close.id)).toBe('');
  });

  it('1702Q (a quarter)', async () => {
    await goTo('2026-07-20');
    const p = await pay('1702Q', '2026-Q2', 150_000, { note: 'Income of the old books before the cut-over' });
    const named = `The 1702Q for April to June 2026 was paid on ${p.number}, recorded 2026-07-20.`;
    expect(await onRecord('2026-04-01')).toBe(recording(named));
    expect(await onRecord('2026-06-30')).toBe(recording(named));
    expect(await onRecord('2026-03-31')).toBe('');
    expect(await onRecord('2026-07-01')).toBe('');
    const inQuarter = await jv('Bank charge found late', [['6190', 5_000], ['1111', -5_000]], '2026-05-15');
    expect(await onCancel('acc.jv', inQuarter.id)).toBe(cancelling(named));
    ok(await cancel('tax.bir_payment', p.id));
    expect(await onRecord('2026-05-15')).toBe('');
    expect(await onCancel('acc.jv', inQuarter.id)).toBe('');
  });

  it('1702 (a year)', async () => {
    await accountant.post('/api/auth/step-up', { password: PASSWORD });
    expect((await accountant.post('/api/tax/income-tax-settings', { effectiveFrom: '2026-07-01', value: { regularRateBp: 2500, mcitRateBp: 200, operationsBeganYear: 2015 }, reason: 'Confirmed with the accountant for the year' })).statusCode).toBe(200);
    const sale = await jv('Sales of the month', [['1101', 50_000_000], ['4101', -50_000_000, { type: 'customer', id: customer }]]);
    await goTo('2027-01-15');
    await record('tax.it_provision', { year: 2026 }, '2026-12-31');
    await record('tax.it_settlement', { year: 2026 });
    const left = ((await accountant.get('/api/tax/payments/due')).json() as { form: string; payableCents: number }[]).find((d) => d.form === '1702')!.payableCents;
    const p = await pay('1702', '2026', left);
    const named = `The 1702 for 2026 was paid on ${p.number}, recorded 2027-01-15.`;
    expect(await onRecord('2026-01-01')).toBe(recording(named));
    expect(await onRecord('2026-12-31')).toBe(recording(named));
    expect(await onRecord('2027-01-02')).toBe('');
    expect(await onCancel('acc.jv', sale.id)).toBe(cancelling(named));
    ok(await cancel('tax.bir_payment', p.id));
    expect(await onRecord('2026-12-31')).toBe('');
    expect(await onCancel('acc.jv', sale.id)).toBe('');
  });

  it('the preview before Cancel needs the cancel permission and writes nothing', async () => {
    const rent = await julyRent();
    await goTo('2026-08-10');
    await pay('0619-E', '2026-07', 50_000);
    const count = () => env.db.prepare('SELECT COUNT(*) FROM audit_log').pluck().get();
    const before = count();
    expect((await accountant.get(`/api/docs/acc.jv/${rent.id}/cancel-preview`)).json()).toMatchObject({ number: rent.number, businessDate: '2026-07-01', cancelDate: '2026-08-10' });
    expect(count()).toBe(before);
    expect((await encoder.get(`/api/docs/acc.jv/${rent.id}/cancel-preview`)).statusCode).toBe(403);
  });
});

describe('the 1601-C a withholding-tax remittance pays (a month)', () => {
  it('warns on record and on cancel for the month it paid; not once the remittance is cancelled', async () => {
    const w = await world('2026-09-15');
    w.person('Dee Mataas', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_500_000 }, { costCentre: 'office' });
    const run = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' });
    w.at('2026-10-05');
    const e = { db: w.db, clock: w.env.clock, notices: w.env.deps.registry.notices() };
    const amountCents = dueOf(w.db, 'WTAX', '2026-09');
    expect(amountCents).toBeGreaterThan(0);
    const input = { scheme: 'WTAX' as const, month: '2026-09', cashPlaceId: cashPlaceId(w.db, '1111'), amountCents, reference: 'eFPS 1601-C 0001' };
    const rem = postDocument(e, remittanceDoc, w.actor, { input, expectedTotalCents: previewDocument(e, remittanceDoc, w.actor, input).totalCents });
    const probeOn = (businessDate: string) =>
      filed(previewDocument(e, jvDoc, w.actor, { memo: 'Bank charge found late', lines: [{ accountId: cashPlaceId(w.db, '6190'), debitCents: 5_000 }, { accountId: cashPlaceId(w.db, '1111'), creditCents: 5_000 }], lateReason: 'Found in the month-end review' }, businessDate).issues)
        .map((i) => i.message).join('\n');
    const named = `The 1601-C for September 2026 was paid on ${rem.number}, recorded 2026-10-05.`;
    expect(probeOn('2026-09-20')).toBe(recording(named));
    expect(probeOn('2026-09-01')).toBe(recording(named));
    expect(probeOn('2026-10-01')).toBe('');
    expect(probeOn('2026-08-31')).toBe('');
    expect(filed(previewCancel(e, runDoc, w.actor, run.id).issues).map((i) => i.message)).toEqual([cancelling(named)]);
    expect(filedReturnsCovering(w.db, '2026-09-30')).toMatchObject([{ form: '1601-C', period: '2026-09', payment: { number: rem.number } }]);
    cancelDocument(e, remittanceDoc, w.actor, rem.id, 'Paid against the wrong month');
    expect(probeOn('2026-09-20')).toBe('');
    expect(filed(previewCancel(e, runDoc, w.actor, run.id).issues)).toEqual([]);
  });
});

describe('changes after filing (ACC-22)', () => {
  type Row = { date: string; number: string; docTitle: string; what: string; userName: string; at: string; form: string; periodLabel: string; paymentNumber: string };
  const report = async (who = accountant) => {
    const res = await who.get('/api/tax/changes-after-filing');
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { rows: Row[] }).rows;
  };

  it('lists exactly the documents dated in a filed period recorded or cancelled after its payment was recorded', async () => {
    const before = await julyRent(); // recorded before the filing: not a change after it
    const beforeToo = await jv('Bank charge', [['6190', 5_000], ['1111', -5_000]], '2026-07-01');
    await goTo('2026-08-10');
    const p = await pay('0619-E', '2026-07', 50_000);
    expect(await report()).toEqual([]);

    await goTo('2026-08-12');
    const late = await jv('Bank charge found late', [['6190', 7_500], ['1111', -7_500]], '2026-07-25');
    ok(await cancel('acc.jv', beforeToo.id));
    await jv('August bank charge', [['6190', 2_500], ['1111', -2_500]], '2026-08-05'); // August is not filed
    await jv('Bank charge of June', [['6190', 2_500], ['1111', -2_500]], '2026-06-30'); // neither is June
    await goTo('2026-08-14');
    ok(await cancel('acc.jv', late.id));

    const rows = await report();
    const base = { docTitle: 'Journal Voucher', form: '0619-E', periodLabel: 'July 2026', paymentNumber: p.number };
    expect(rows.map((r) => ({ ...r, userName: r.userName.split('-')[0] }))).toEqual([
      // The same moment (the test clock stands still): by number.
      expect.objectContaining({ ...base, date: '2026-07-01', number: beforeToo.number, what: 'cancelled', userName: 'accountant', at: expect.stringMatching(/^2026-08-12T10:00/) }),
      expect.objectContaining({ ...base, date: '2026-07-25', number: late.number, what: 'recorded', userName: 'accountant', at: expect.stringMatching(/^2026-08-12T10:00/) }),
      expect.objectContaining({ ...base, date: '2026-07-25', number: late.number, what: 'cancelled', userName: 'accountant', at: expect.stringMatching(/^2026-08-14T10:00/) }),
    ]);
    expect(rows.map((r) => r.number)).not.toContain(before.number);

    // For the accountant and the owners, with CSV; not for the encoder.
    expect((await report(owner)).length).toBe(3);
    expect((await encoder.get('/api/tax/changes-after-filing')).statusCode).toBe(403);
    const csv = await accountant.get('/api/tax/changes-after-filing?format=csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.body.trim().split(/\r?\n/);
    expect(lines[0]).toContain('"Date","Document","Number","What happened","Who","When","Return","Period","Paid with","Payment recorded"');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain(`"2026-07-25","Journal Voucher","${late.number}","Recorded",`);

    // A payment cancelled: its return is not filed, so nothing changed after filing it.
    ok(await cancel('tax.bir_payment', p.id));
    expect(await report()).toEqual([]);
  });
});
