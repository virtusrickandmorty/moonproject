/**
 * The month in the life (PLAN I2 G-30, I1 item 8): one fresh shop, driven only through the HTTP API with a moving clock.
 * The opening balances of G-27 on the cut-over date (31 August 2026), then G-01 to G-24 on fixed dates in September
 * 2026, a month that ends a quarter, then the month-end: the depreciation run, a cash count, the government
 * remittances, the EWT return, the VAT close and its 2550Q payment. G-04 and G-05 (G-01/G-02 in downpayment VAT modes B
 * and C) come on 24 and 25 September, each on a job order of its own, with the accountant switching the mode for the day
 * and back to mode A after: so the documents of G-06 to G-24 keep their numbers.
 *
 * Each step is data (its reference, date and the facts a person would type, in plain words) plus the API calls that
 * record it. The data is what `tools/blind-pack.ts` hands the blind reviewers; the calls are what the month test and
 * `tools/compare-blind.ts` run. The expected journals are not here: they are worked out by hand in the test.
 *
 * One step cannot be recorded as the PLAN words it, and the step says so instead of changing posting code:
 *   the third month of a quarter has no 0619-E (D5 EWT-REM; bir-payment.ts): September's EWT is paid with the 1601-EQ.
 * Two goldens read the books as they are on the day, so their figures follow the month and not the stand-alone golden:
 *   G-18 counts the cash box ₱50.00 short of whatever the ledger says, and G-22 counts ₱25,000.00 of materials against
 *   a ledger of zero (G-27 opens no inventory, and one count per month end is allowed).
 */
import type { LightMyRequestResponse } from 'fastify';
import { PASSWORD, createTestEnv, createUser, idem, login, type Client, type TestEnv } from '../apps/server/test/helpers.ts';
import { PARTY_ACCOUNTS, type BlindRow } from './blind.ts';

export const CUTOVER = '2026-08-31';
export const MONTH_END = '2026-09-30';

/** One step of the month: what the blind reviewers read, and what the app is told. */
export interface Step {
  /** The reference each journal of the step carries (`doc_ref` in the CSV); refused steps have no journal. */
  refs: string[];
  date: string;
  title: string;
  /** The facts typed on the document, in plain words: amounts, choices, who and where. No debits or credits. */
  facts: string[];
  /** Left out of the blind pack (a refused step, or one the app cannot record yet). */
  notInPack?: string;
  run(m: Month): Promise<void>;
}

/** A document the month recorded, by the reference its journal carries. */
export interface Recorded { ref: string; type: string; id: string; number: string; date: string; kind: 'original' | 'reversal' }

export interface JournalRow { ref: string; line: number; accountCode: string; debitCents: number; creditCents: number; party: string; taxKind: string }

type Who = 'acc' | 'own' | 'enc';

/** The running month: the clock, signed-in people, the master data made, and what was recorded. */
export class Month {
  readonly recorded: Recorded[] = [];
  readonly refusals: { step: string; code: string; message: string }[] = [];
  /** "type:id" of a party (customer, supplier or one-off payee TIN, employee, officer, loan, asset) → the label the pack uses. */
  readonly labels = new Map<string, string>();
  readonly ids: Record<string, string> = {};
  /** Cash places and expense categories by account code. */
  readonly places: Record<string, number> = {};
  readonly categories: Record<string, number> = {};
  private clients = {} as Record<Who, Client>;
  private users = {} as Record<Who, string>;
  private today = '';

  constructor(readonly env: TestEnv) {}

  get date() {
    return this.today;
  }

  /** Moves the clock to 10:00 in Manila on `date` and signs everyone in again (yesterday's sessions have timed out). */
  async on(date: string) {
    if (date === this.today) return;
    if (date < this.today) throw new Error(`The month runs forward: ${date} is before ${this.today}.`);
    this.env.clock.set(`${date}T02:00:00Z`);
    this.today = date;
    if (!this.users.acc) {
      // The people who work the month (test users, as every API test makes them).
      for (const [who, role] of [['acc', 'accountant'], ['own', 'owner'], ['enc', 'encoder']] as const) {
        createUser(this.env.db, `month-${role}`, [role]);
        this.users[who] = `month-${role}`;
      }
    }
    for (const w of ['acc', 'own', 'enc'] as Who[]) this.clients[w] = await login(this.env.app, this.users[w], PASSWORD);
  }

  as(who: Who): Client {
    return this.clients[who];
  }

  async stepUp(who: Who = 'acc') {
    ok(await this.as(who).post('/api/auth/step-up', { password: PASSWORD }), 'step-up');
  }

  async get<T = any>(url: string, who: Who = 'acc'): Promise<T> {
    return ok(await this.as(who).get(url), `GET ${url}`).json() as T;
  }

  async call<T = any>(url: string, body: unknown, who: Who = 'acc', headers: Record<string, string> = {}): Promise<T> {
    return ok(await this.as(who).post(url, body, headers), `POST ${url}`).json() as T;
  }

  /** Previews a document (for the total the person confirms), then records it; the journal is tagged `ref`. */
  async post(ref: string, type: string, input: object, o: { who?: Who; total?: number; businessDate?: string } = {}) {
    const who = o.who ?? 'acc';
    const dated = o.businessDate ? { businessDate: o.businessDate } : {};
    const total = o.total ?? (await this.call(`/api/docs/${type}/preview`, { input, ...dated }, who)).totalCents;
    const res = await this.call(`/api/docs/${type}/post`, { input, expectedTotalCents: total, ...dated }, who, idem());
    return this.record(ref, type, res);
  }

  /** A document the API refuses: the step checks the code and records nothing. */
  async refused(step: string, type: string, input: object, code: string, who: Who = 'acc') {
    const pre = await this.call(`/api/docs/${type}/preview`, { input }, who);
    const res = await this.as(who).post(`/api/docs/${type}/post`, { input, expectedTotalCents: pre.totalCents }, idem());
    const issue = (res.json().details ?? []).find((i: { code: string }) => i.code === code);
    if (res.statusCode !== 422 || !issue) throw new Error(`${step}: expected ${type} to be refused with ${code}, got ${res.statusCode} ${res.body}`);
    this.refusals.push({ step, code, message: issue.message });
  }

  record(ref: string, type: string, res: { id: string; number: string; businessDate: string }, kind: Recorded['kind'] = 'original') {
    const r: Recorded = { ref, type, id: res.id, number: res.number, date: res.businessDate, kind };
    this.recorded.push(r);
    return r;
  }

  doc(ref: string): Recorded {
    const r = this.recorded.find((x) => x.ref === ref);
    if (!r) throw new Error(`No document recorded as ${ref}`);
    return r;
  }

  label(type: string, id: string, name: string) {
    this.labels.set(`${type}:${id}`, name);
    return id;
  }

  /** Every journal of the month, through the API, in the order recorded, parties named by their labels. */
  async journals(): Promise<JournalRow[]> {
    const tax: Record<string, string> = { '2301': 'output_vat', '1401': 'input_vat', '1410': 'cwt', '1404': 'vat_withheld', '2311': 'ewt', '2310': 'wtax' };
    const rows: JournalRow[] = [];
    for (const r of this.recorded) {
      const d = await this.get(`/api/docs/${r.type}/${r.id}`);
      const j = (d.journals as { postingKind: string; lines: { accountCode: string; partyType: string | null; partyId: string | null; debitCents: number; creditCents: number }[] }[])
        .find((x) => x.postingKind === r.kind);
      if (!j) throw new Error(`${r.ref} (${r.number}) has no ${r.kind} journal`);
      j.lines.forEach((l, i) =>
        rows.push({
          ref: r.ref, line: i + 1, accountCode: l.accountCode, debitCents: l.debitCents, creditCents: l.creditCents,
          party: l.partyId === null ? '' : (this.labels.get(`${l.partyType}:${l.partyId}`) ?? `unlabelled ${l.partyType} ${l.partyId}`), taxKind: tax[l.accountCode] ?? '',
        }),
      );
    }
    return rows;
  }
}

function ok(res: LightMyRequestResponse, what: string): LightMyRequestResponse {
  if (res.statusCode !== 200) throw new Error(`${what} failed: ${res.statusCode} ${res.body}`);
  return res;
}

/** Made-up customers, suppliers and people (AGENTS.md: no real data). */
const SCHOOL = 'Test School';
const CITY = 'Sample City Hall';
const PARISH = 'Sample Parish';
const CLUB = 'Sample Dance Club';
const OWNER_A = 'Sample Owner A';
const FABRIC = 'Sample Fabric Trading';
const MACHINES = 'Sample Machines';
const LESSOR = 'Sample Lessor Corp.';
const LANDLORD = 'Sample Landlord';
const CARLA = 'Carla Opisina';
const ANA = 'Ana Tahi';
const OPENING_LOAN = 'Sample Lending loan';
const BANK_LOAN = 'Sample Bank loan';
const FINANCING = 'Heat press financing';
const EMBROIDERY = 'Embroidery machine';
const HEAT_PRESS = 'Heat press';

/** A one-line made-to-order job order of the Test School (or another customer), moved to Ready for release. */
async function jobOrder(m: Month, lines: { qty: number; unitPriceCents: number; discountCents?: number }[], customer = SCHOOL): Promise<string> {
  const input = {
    customerId: m.ids[customer], dueInDays: 15, priority: 'normal', paymentTerms: 'dp50',
    lines: lines.map((l) => ({ kind: 'made_to_order', description: 'Team jersey set', discountCents: 0, roster: [], ...l })),
  };
  const total = lines.reduce((s, l) => s + l.qty * l.unitPriceCents - (l.discountCents ?? 0), 0);
  const jo = await m.call('/api/docs/jo.job_order/post', { input, expectedTotalCents: total }, 'enc', idem());
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await m.call(`/api/jo/orders/${jo.id}/stage`, { from, to }, 'enc');
  return jo.id;
}

/** Releases every piece of a job order with its invoice record (a credit release when a balance is still due). */
async function releaseWithInvoice(m: Month, ref: string, jo: string, qty: number, invoiceNumber: string, grossCents: number) {
  const due = (await m.get(`/api/jo/orders/${jo}/status`)).money.balanceDueCents > 0;
  const release = {
    jobOrderId: jo, lines: [{ lineNo: 1, qty }], claimedBy: 'Coach Placeholder', idSeen: 'school_id',
    ...(due ? { creditNote: 'Balance by bank transfer after the event', creditDueInDays: 7 } : {}),
  };
  const res = await m.call('/api/jo/releases', { release, invoice: { invoiceNumber }, expectedTotalCents: grossCents }, 'acc', idem());
  return m.record(ref, 'jo.invoice_record', res.invoiceRecord);
}

const collection = (m: Month, ref: string, input: object, total: number) => m.post(ref, 'col.collection', input, { who: 'enc', total });

export const STEPS: Step[] = [
  {
    refs: [],
    date: '2026-09-01',
    title: 'Master data and booklets (no journal)',
    facts: [
      `Customers: ${SCHOOL} (VAT-registered, TIN 000-111-222-000, withholds 1% on goods); ${CITY} (government buyer, TIN 000-333-444-000: withholds 1% CWT and 5% VAT); ${PARISH} and ${CLUB} (customers from before the cut-over).`,
      `Stockholder: ${OWNER_A} (President). Supplier on file: ${FABRIC} (VAT-registered, TIN 111-222-333-000; usual EWT class goods 1%, but Virtus is not a Top Withholding Agent, so none is withheld).`,
      `Supplier on file: ${MACHINES} (VAT-registered, TIN 123-456-000-000).`,
      `Employee: ${CARLA}, office, ₱15,000.00 a month, semi-monthly (monthly staff) group, hired 2025-01-06.`,
      'Settings in force: VAT 12%; downpayment VAT mode A (deposit only); Virtus is not a Top Withholding Agent; EWT on rent 5%; payroll per PLAN F1 and F3, with the 13th-month pay accrued each run (1/12 of the basic pay in it, overtime excluded).',
    ],
    async run(m) {
      await m.on(this.date);
      const places = await m.get<{ id: number; code: string }[]>('/api/cash/places');
      for (const code of ['1101', '1102', '1111', '1112', '1121']) m.places[code] = places.find((p) => p.code === code)!.id;
      const customer = async (name: string, body: object) => (m.ids[name] = m.label('customer', (await m.call('/api/cus/customers', { displayName: name, ...body }, 'enc')).id, name));
      await customer(SCHOOL, { kind: 'organization', registeredName: 'Test School Inc.', tin: '000-111-222-000', isVatRegistered: true, withholdingProfile: 'twa_goods' });
      await customer(CITY, { kind: 'organization', registeredName: 'Sample City Government', tin: '000-333-444-000', isVatRegistered: false, withholdingProfile: 'government' });
      await customer(PARISH, { kind: 'organization' });
      await customer(CLUB, { kind: 'organization' });
      const person = (await m.call('/api/eq/people', { name: OWNER_A, isStockholder: true, isOfficer: true, position: 'President', shares: 2500 })).id;
      m.ids[OWNER_A] = m.label('officer', person, OWNER_A);
      m.label('stockholder', person, OWNER_A);
      const supplier = async (name: string, body: object) => (m.ids[name] = m.label('supplier', (await m.call('/api/pur/suppliers', { name, registeredName: `${name} Inc.`, ...body })).id, name));
      await supplier(FABRIC, { tin: '111-222-333-000', isVatRegistered: true, ewtClass: 'goods_1', paymentTermsDays: 30 });
      await supplier(MACHINES, { tin: '123-456-000-000', isVatRegistered: true });
      m.label('supplier', 'tin:123456789000', LESSOR);
      m.label('supplier', 'tin:987654321000', LANDLORD);
      for (const c of await m.get<{ id: number; code: string }[]>('/api/exp/categories', 'enc')) m.categories[c.code] = c.id;
      for (const [name, unit] of [['Cotton twill', 'yard'], ['Thread cone', 'pc']] as const) m.ids[name] = (await m.call('/api/pur/supplies', { name, unit, category: 'materials' })).id;
      const carla = await m.call('/api/emp/employees', { fullName: CARLA, costCentre: 'office', hireDate: '2025-01-06', position: 'Office clerk' });
      m.ids[CARLA] = m.label('employee', carla.id, CARLA);
      await m.call(`/api/emp/employees/${carla.id}/pay`, { effectiveFrom: '2025-01-06', payType: 'monthly', monthlyRateCents: 1_500_000, payGroup: 'SEMI_MONTHLY', workweekDays: 6, isMwe: false, reason: 'Pay on hiring, from the old records' }, 'own');
      await m.stepUp();
      await m.call('/api/tax/booklets', { kind: 'SALES_INVOICE', atpNo: 'OCN 0AU0001234567', printer: 'Made-up Printing Press', serialFrom: 501, serialTo: 550, receivedOn: '2026-08-15' });
      await m.call('/api/tax/booklets', { kind: 'CR', atpNo: 'OCN 0AU0007654321', printer: 'Made-up Printing Press', serialFrom: 101, serialTo: 150, receivedOn: '2026-08-15' });
    },
  },
  {
    refs: ['G-27a', 'G-27b', 'G-27c', 'G-27d', 'G-27e', 'G-27f'],
    date: '2026-09-01',
    title: 'G-27 Opening balances, dated the cut-over date 2026-08-31 (recorded 1 September by the accountant)',
    facts: [
      'G-27a cash: cash on hand ₱20,000.00; Cash in bank – BDO ₱150,000.00.',
      `G-27b receivable: ${PARISH}, old job order JO 1150 delivered and invoiced (old invoice 0412), ₱36,000.00 not yet paid (an opening invoice record).`,
      `G-27c fixed asset "${EMBROIDERY}": machinery, acquired 2026-08-31, cost ₱300,000.00, residual ₱5,000.00, life 60 months, accumulated depreciation ₱0.00 (the old books had not depreciated it). August counts as its first month of life, so from September the ₱295,000.00 to depreciate is spread over the 59 months left.`,
      `G-27d undelivered job order of ${CLUB}: old JO 1187, 20 pieces × ₱2,000.00 still to make, ₱20,000.00 of downpayments collected before the cut-over.`,
      `G-27e loan "${OPENING_LOAN}": ₱200,000.00 principal still owed (₱300,000.00 received 2025-09-01, 12% a year, flat, 10 monthly instalments left from 2026-10-01).`,
      `G-27f equity: capital stock ₱250,000.00 (${OWNER_A}); retained earnings ₱36,000.00. Opening balance equity (3900) is then zero and the opening is closed.`,
    ],
    async run(m) {
      await m.on(this.date);
      await m.stepUp();
      await m.call('/api/acc/opening/cutover-date', { date: CUTOVER });
      const acct = async (code: string) => (await m.get<{ accounts: { id: number; code: string }[] }>('/api/acc/opening')).accounts.find((a) => a.code === code)!.id;
      const ob = { businessDate: CUTOVER };
      await m.post('G-27a', 'acc.opening', { lines: [{ accountId: await acct('1101'), debitCents: 2_000_000 }, { accountId: await acct('1111'), debitCents: 15_000_000 }] }, { ...ob, total: 17_000_000 });
      const joOpening = { dueDate: '2026-09-30', priority: 'normal', paymentTerms: 'dp50' };
      await m.post('G-27b', 'jo.opening', { ...joOpening, customerId: m.ids[PARISH], oldNumber: 'JO 1150', lines: [], depositsCents: 0, receivableCents: 3_600_000, oldInvoices: '0412' }, { ...ob, total: 3_600_000 });
      const machine = await m.post('G-27c', 'fa.opening', { classCode: 'machinery', description: EMBROIDERY, acquiredOn: CUTOVER, costCents: 30_000_000, residualCents: 500_000, lifeMonths: 60, accumulatedCents: 0 }, { ...ob, total: 30_000_000 });
      m.label('asset', machine.id, EMBROIDERY);
      const club = await m.post('G-27d', 'jo.opening', {
        ...joOpening, customerId: m.ids[CLUB], oldNumber: 'JO 1187', depositsCents: 2_000_000, depositsMemo: 'Old receipt 3310', receivableCents: 0,
        lines: [{ kind: 'made_to_order', description: 'Dance costume set', qty: 20, unitPriceCents: 200_000, discountCents: 0, roster: [] }],
      }, { ...ob, total: 4_000_000 });
      m.ids.clubJo = club.id;
      const loan = await m.post('G-27e', 'loan.opening', {
        lender: 'Sample Lending', kind: 'loan', originalPrincipalCents: 30_000_000, dateReceived: '2025-09-01', principalCents: 20_000_000, interestRateBp: 1200, monthsLeft: 10,
        schedule: 'flat', nextDueDate: '2026-10-01', reference: 'PN 2025-009',
      }, { ...ob, total: 20_000_000 });
      m.label('loan', loan.id, OPENING_LOAN);
      await m.post('G-27f', 'acc.opening', {
        lines: [
          { accountId: await acct('3101'), stockholderId: m.ids[OWNER_A], creditCents: 25_000_000 },
          { accountId: await acct('3201'), creditCents: 3_600_000, memo: 'Retained earnings to the cut-over date' },
        ],
      }, { ...ob, total: 28_600_000 });
      await m.stepUp();
      await m.call('/api/acc/opening/close', {});
    },
  },
  {
    refs: ['S-01'],
    date: '2026-09-01',
    title: 'Petty cash fund (a transfer)',
    facts: ['S-01 fund transfer from cash on hand to the petty cash fund: ₱2,000.00 sent, ₱2,000.00 received.'],
    async run(m) {
      await m.post('S-01', 'cash.transfer', { fromCashPlaceId: m.places['1101'], toCashPlaceId: m.places['1102'], amountSentCents: 200_000, amountReceivedCents: 200_000 }, { who: 'enc', total: 200_000 });
    },
  },
  {
    refs: ['G-01'],
    date: '2026-09-01',
    title: 'G-01 Job order and downpayment',
    facts: [`JO-000001 for ${SCHOOL}: 20 made-to-order team jersey sets × ₱2,800.00 = ₱56,000.00 (no journal).`, 'G-01 collection, CR 0101: downpayment ₱28,000.00 in cash on hand, applied to JO-000001 (not yet invoiced).'],
    async run(m) {
      m.ids.jo1 = await jobOrder(m, [{ qty: 20, unitPriceCents: 280_000 }]);
      await collection(m, 'G-01', { customerId: m.ids[SCHOOL], crNumber: '0101', applications: [{ jobOrderId: m.ids.jo1, amountCents: 2_800_000 }], tenders: [{ cashPlaceId: m.places['1101'], amountCents: 2_800_000 }] }, 2_800_000);
    },
  },
  {
    refs: ['G-02', 'G-03'],
    date: '2026-09-02',
    title: 'G-02 Release with invoice; G-03 balance collected',
    facts: [
      'G-02: all 20 pieces of JO-000001 released on credit with manual invoice no. 0501 (₱56,000.00, VAT-inclusive, one made-to-order line). The ₱28,000.00 deposit is applied.',
      `G-03 collection, CR 0102: ${SCHOOL} pays the ₱28,000.00 balance of invoice 0501: GCash ₱10,000.00, cash on hand ₱17,750.00, and ₱250.00 withheld (1% CWT, ATC WC158, 2307 not yet received).`,
    ],
    async run(m) {
      await m.on(this.date);
      await releaseWithInvoice(m, 'G-02', m.ids.jo1!, 20, '0501', 5_600_000);
      await collection(m, 'G-03', {
        customerId: m.ids[SCHOOL], crNumber: '0102', applications: [{ jobOrderId: m.ids.jo1, amountCents: 2_800_000 }],
        tenders: [{ cashPlaceId: m.places['1121'], amountCents: 1_000_000, reference: 'GC-REF-1234' }, { cashPlaceId: m.places['1101'], amountCents: 1_775_000 }],
        withholding: { cwtCents: 25_000, atc: 'WC158', certificate: 'pending' },
      }, 2_800_000);
    },
  },
  {
    refs: ['G-06a', 'G-06'],
    date: '2026-09-07',
    title: 'G-06 One collection for an invoiced and an un-invoiced job order',
    facts: [
      `JO-000002 for ${SCHOOL}: 20 jersey sets × ₱2,800.00 = ₱56,000.00, not invoiced. JO-000003: 1 set at ₱10,000.00 (no journals).`,
      'G-06a: JO-000003 released on credit with invoice no. 0502 (₱10,000.00, made-to-order).',
      'G-06 collection, CR 0103: ₱25,000.00 (cash on hand ₱5,000.00 + BDO ₱20,000.00): ₱10,000.00 to invoice 0502 (JO-000003) and ₱15,000.00 to JO-000002 (not invoiced).',
    ],
    async run(m) {
      await m.on(this.date);
      m.ids.jo2 = await jobOrder(m, [{ qty: 20, unitPriceCents: 280_000 }]);
      m.ids.jo3 = await jobOrder(m, [{ qty: 1, unitPriceCents: 1_000_000 }]);
      await releaseWithInvoice(m, 'G-06a', m.ids.jo3, 1, '0502', 1_000_000);
      await collection(m, 'G-06', {
        customerId: m.ids[SCHOOL], crNumber: '0103', applications: [{ jobOrderId: m.ids.jo3, amountCents: 1_000_000 }, { jobOrderId: m.ids.jo2, amountCents: 1_500_000 }],
        tenders: [{ cashPlaceId: m.places['1101'], amountCents: 500_000 }, { cashPlaceId: m.places['1111'], amountCents: 2_000_000 }],
      }, 2_500_000);
    },
  },
  {
    refs: ['G-07a', 'G-07'],
    date: '2026-09-08',
    title: 'G-07 Overpayment kept as a deposit',
    facts: ['JO-000004: 1 set at ₱10,000.00 (no journal).', 'G-07a: JO-000004 released on credit with invoice no. 0503 (₱10,000.00, made-to-order).', 'G-07 collection, CR 0104: ₱12,000.00 in cash on hand, ₱10,000.00 applied to invoice 0503; ₱2,000.00 left unapplied (customer deposit, no job order).'],
    async run(m) {
      await m.on(this.date);
      m.ids.jo4 = await jobOrder(m, [{ qty: 1, unitPriceCents: 1_000_000 }]);
      await releaseWithInvoice(m, 'G-07a', m.ids.jo4, 1, '0503', 1_000_000);
      await collection(m, 'G-07', { customerId: m.ids[SCHOOL], crNumber: '0104', applications: [{ jobOrderId: m.ids.jo4, amountCents: 1_000_000 }], tenders: [{ cashPlaceId: m.places['1101'], amountCents: 1_200_000 }] }, 1_200_000);
    },
  },
  {
    refs: ['G-07b', 'G-08a', 'G-08b'],
    date: '2026-09-09',
    title: 'G-07 refund; G-08 quick sale',
    facts: [
      `G-07b refund: the ₱2,000.00 unapplied payment paid back to ${SCHOOL} from cash on hand.`,
      `G-08a quick sale to ${SCHOOL}: alteration (a service) ₱350.00, manual invoice no. 0504.`,
      'G-08b its payment, CR 0105: ₱350.00 in cash on hand, applied to invoice 0504.',
    ],
    async run(m) {
      await m.on(this.date);
      await m.post('G-07b', 'col.refund', { customerId: m.ids[SCHOOL], tenders: [{ cashPlaceId: m.places['1101'], amountCents: 200_000 }], reason: 'Overpayment returned to the customer' }, { total: 200_000 });
      const sale = { customerId: m.ids[SCHOOL], invoiceNumber: '0504', lines: [{ kind: 'service', description: 'Alteration: shorten sleeves', qty: 1, unitPriceCents: 35_000, discountCents: 0 }] };
      const res = await m.call('/api/qs/sales', { sale, payment: { crNumber: '0105', tenders: [{ cashPlaceId: m.places['1101'], amountCents: 35_000 }] }, expectedTotalCents: 35_000 }, 'enc', idem());
      m.record('G-08a', 'qs.sale', res.sale);
      m.record('G-08b', 'col.collection', res.payment);
    },
  },
  {
    refs: ['G-09a', 'G-09'],
    date: '2026-09-10',
    title: 'G-09 Government customer',
    facts: [`JO-000005 for ${CITY}: 1 lot of uniforms at ₱112,000.00 (no journal).`, 'G-09a: JO-000005 released on credit with invoice no. 0505 (₱112,000.00, made-to-order).', 'G-09 collection, CR 0106: BDO ₱106,000.00; the city withheld 5% VAT ₱5,000.00 and 1% CWT ₱1,000.00 (ATC WC158), 2307 received.'],
    async run(m) {
      await m.on(this.date);
      m.ids.jo5 = await jobOrder(m, [{ qty: 1, unitPriceCents: 11_200_000 }], CITY);
      await releaseWithInvoice(m, 'G-09a', m.ids.jo5, 1, '0505', 11_200_000);
      await collection(m, 'G-09', {
        customerId: m.ids[CITY], crNumber: '0106', applications: [{ jobOrderId: m.ids.jo5, amountCents: 11_200_000 }], tenders: [{ cashPlaceId: m.places['1111'], amountCents: 10_600_000 }],
        withholding: { cwtCents: 100_000, atc: 'WC158', certificate: 'received', vatWithheldCents: 500_000 },
      }, 11_200_000);
    },
  },
  {
    refs: ['G-10'],
    date: '2026-09-11',
    title: 'G-10 Invoice with a discount shown',
    facts: [`JO-000006 for ${SCHOOL}: 20 jersey sets × ₱2,800.00 less a ₱5,600.00 discount = ₱50,400.00 (no journal).`, 'G-10: JO-000006 released on credit with invoice no. 0506 (₱50,400.00), which shows the ₱5,600.00 discount.'],
    async run(m) {
      await m.on(this.date);
      m.ids.jo6 = await jobOrder(m, [{ qty: 20, unitPriceCents: 280_000, discountCents: 560_000 }]);
      await releaseWithInvoice(m, 'G-10', m.ids.jo6, 20, '0506', 5_040_000);
    },
  },
  {
    refs: ['G-11'],
    date: '2026-09-14',
    title: 'G-11 Credit memo (allowance)',
    facts: ['G-11: the accountant records an allowance of ₱5,600.00 (VAT-inclusive) on invoice 0506, form no. 0012: two sets delivered with the wrong print. The invoice is unpaid.'],
    async run(m) {
      await m.on(this.date);
      await m.post('G-11', 'col.credit_memo', { invoiceId: m.doc('G-10').id, kind: 'allowance', amountCents: 560_000, formNumber: '0012', reason: 'Two sets delivered with the wrong print' }, { total: 560_000 });
    },
  },
  {
    refs: ['G-12a', 'G-12', 'G-24a', 'S-02'],
    date: '2026-09-15',
    title: 'G-12 collection put in GCash by mistake; payroll cutoff 1',
    facts: [
      'JO-000007: 1 set at ₱10,000.00 (no journal).',
      'G-12a: JO-000007 released on credit with invoice no. 0507 (₱10,000.00, made-to-order).',
      'G-12 collection, CR 0107: ₱10,000.00 for invoice 0507, recorded in GCash (by mistake: it was cash).',
      `G-24a payroll run, semi-monthly (monthly staff) group, 1–15 September: ${CARLA} (half the monthly rate; PhilHealth is on the monthly basic salary, taken whole on the first cutoff of the month; SSS and Pag-IBIG on month-to-date pay, F3).`,
      `S-02 payroll release of that run: ${CARLA}'s net pay from cash on hand.`,
    ],
    async run(m) {
      await m.on(this.date);
      m.ids.jo7 = await jobOrder(m, [{ qty: 1, unitPriceCents: 1_000_000 }]);
      await releaseWithInvoice(m, 'G-12a', m.ids.jo7, 1, '0507', 1_000_000);
      m.ids.g12 = (await collection(m, 'G-12', { customerId: m.ids[SCHOOL], crNumber: '0107', applications: [{ jobOrderId: m.ids.jo7, amountCents: 1_000_000 }], tenders: [{ cashPlaceId: m.places['1121'], amountCents: 1_000_000 }] }, 1_000_000)).id;
      const run = await m.post('G-24a', 'pay.run', { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' });
      await payOut(m, 'S-02', run.id, [CARLA]);
    },
  },
  {
    refs: ['G-12r', 'G-12b', 'G-13'],
    date: '2026-09-16',
    title: 'G-12 edited to cash; G-13 rent',
    facts: [
      'G-12r: the collection of 15 September (G-12) is edited: it was paid in cash, not GCash. The edit cancels it today (G-12r is the cancel) ...',
      'G-12b: ... and records it again, in cash on hand, on a new CR 0108 (₱10,000.00 for invoice 0507).',
      `G-13 expense voucher: rent ₱40,000.00 (VAT-inclusive) paid from BDO to ${LESSOR} (VAT-registered, TIN 123-456-789-000, receipt SI-0101 of 2026-09-16); EWT on rent 5%.`,
    ],
    async run(m) {
      await m.on(this.date);
      const input = { customerId: m.ids[SCHOOL], crNumber: '0108', applications: [{ jobOrderId: m.ids.jo7, amountCents: 1_000_000 }], tenders: [{ cashPlaceId: m.places['1101'], amountCents: 1_000_000 }] };
      const res = await m.call(`/api/docs/col.collection/${m.ids.g12}/reissue`, { input, expectedTotalCents: 1_000_000, reason: 'Paid in cash, not GCash' }, 'enc', idem());
      const first = m.doc('G-12');
      m.record('G-12r', 'col.collection', { id: first.id, number: first.number, businessDate: this.date }, 'reversal');
      m.record('G-12b', 'col.collection', res);
      await m.post('G-13', 'exp.voucher', {
        categoryId: m.categories['6110']!, cashPlaceId: m.places['1111'], amountCents: 4_000_000, description: 'September rent, shop', payeeName: LESSOR, payeeVatRegistered: true,
        payeeTin: '123-456-789-000', supplierInvoiceNo: 'SI-0101', supplierInvoiceDate: this.date,
      }, { who: 'enc', total: 4_000_000 });
    },
  },
  {
    refs: [],
    date: '2026-09-16',
    title: 'A new employee (no journal)',
    facts: [`${ANA} is hired on 2026-09-16: production, daily ₱550.00 (the minimum wage; a minimum wage earner), 6-day week, semi-monthly daily-paid group.`],
    async run(m) {
      await m.on(this.date);
      const ana = await m.call('/api/emp/employees', { fullName: ANA, costCentre: 'production', hireDate: this.date, position: 'Sewer' });
      m.ids[ANA] = m.label('employee', ana.id, ANA);
      await m.call(`/api/emp/employees/${ana.id}/pay`, { effectiveFrom: this.date, payType: 'daily', dailyRateCents: 55_000, payGroup: 'SEMI_DAILY', workweekDays: 6, isMwe: true, reason: 'Pay on hiring: the minimum wage' }, 'own');
    },
  },
  {
    refs: ['G-14', 'G-15'],
    date: '2026-09-17',
    title: 'G-14 rent to a non-VAT lessor; G-15 supplier bill',
    facts: [
      `G-14 expense voucher: rent ₱40,000.00 for the stock room paid from BDO to ${LANDLORD} (not VAT-registered, TIN 987-654-321-000, receipt 0201 of 2026-09-17); EWT on rent 5%.`,
      `G-15 supplier bill: ${FABRIC}, invoice SI-7788 of 2026-09-17, cotton twill ₱11,200.00 (VAT-inclusive; the invoice shows VAT ₱1,200.00).`,
    ],
    async run(m) {
      await m.on(this.date);
      await m.post('G-14', 'exp.voucher', {
        categoryId: m.categories['6110']!, cashPlaceId: m.places['1111'], amountCents: 4_000_000, description: 'September rent, stock room', payeeName: LANDLORD, payeeVatRegistered: false,
        payeeTin: '987-654-321-000', supplierInvoiceNo: '0201', supplierInvoiceDate: this.date,
      }, { who: 'enc', total: 4_000_000 });
      await m.post('G-15', 'ap.bill', { supplierId: m.ids[FABRIC], supplierInvoiceNo: 'SI-7788', supplierInvoiceDate: this.date, lines: [{ supplyId: m.ids['Cotton twill'], amountCents: 1_120_000 }] }, { who: 'enc', total: 1_120_000 });
    },
  },
  {
    refs: ['G-15b', 'G-16'],
    date: '2026-09-18',
    title: 'G-15 part payment; G-16 tricycle',
    facts: ['G-15b supplier payment: ₱5,000.00 from BDO on bill SI-7788.', 'G-16 expense voucher: tricycle ₱200.00 from the petty cash fund, transportation, no VAT receipt.'],
    async run(m) {
      await m.on(this.date);
      await m.post('G-15b', 'ap.payment', { supplierId: m.ids[FABRIC], bills: [{ billId: m.doc('G-15').id, amountCents: 500_000 }], tenders: [{ cashPlaceId: m.places['1111'], amountCents: 500_000 }] }, { who: 'enc', total: 500_000 });
      await m.post('G-16', 'exp.voucher', { categoryId: m.categories['6140']!, cashPlaceId: m.places['1102'], amountCents: 20_000, description: 'Tricycle to the fabric store', payeeName: 'Tricycle driver' }, { who: 'enc', total: 20_000 });
    },
  },
  {
    refs: ['G-17', 'G-18'],
    date: '2026-09-21',
    title: 'G-17 bank transfer; G-18 cash count',
    facts: ['G-17 fund transfer BDO → China Bank: ₱10,000.00 sent, ₱9,975.00 received.', 'G-18 cash count of cash on hand: ₱82,450.00 counted (82 × ₱1,000, 4 × ₱100, 1 × ₱50), against whatever the ledger shows that day.'],
    async run(m) {
      await m.on(this.date);
      await m.post('G-17', 'cash.transfer', { fromCashPlaceId: m.places['1111'], toCashPlaceId: m.places['1112'], amountSentCents: 1_000_000, amountReceivedCents: 997_500 }, { who: 'enc', total: 1_000_000 });
      const lines = [{ denominationCents: 100_000, qty: 82 }, { denominationCents: 10_000, qty: 4 }, { denominationCents: 5_000, qty: 1 }];
      await m.post('G-18', 'cash.count', { cashPlaceId: m.places['1101'], lines }, { total: 8_245_000 });
    },
  },
  {
    refs: ['G-19', 'G-20'],
    date: '2026-09-22',
    title: 'G-19 owner money; G-20 loan',
    facts: [
      `G-19 owner money: ${OWNER_A} puts ₱100,000.00 into BDO, classified "advance from stockholder".`,
      `G-20 loan "${BANK_LOAN}" from Sample Bank: ₱500,000.00 principal, ₱5,000.00 fee deducted, ₱495,000.00 received in BDO; 12% a year, flat, 25 months (instalments ₱25,000.00 = ₱20,000.00 principal + ₱5,000.00 interest).`,
    ],
    async run(m) {
      await m.on(this.date);
      await m.post('G-19', 'eq.owner_money', { personId: m.ids[OWNER_A], cashPlaceId: m.places['1111'], amountCents: 10_000_000, classification: 'advance' }, { who: 'enc', total: 10_000_000 });
      const loan = await m.post('G-20', 'loan.loan', {
        lender: 'Sample Bank', kind: 'loan', cashPlaceId: m.places['1111'], principalCents: 50_000_000, feeCents: 500_000, interestRateBp: 1200, termMonths: 25, schedule: 'flat', reference: 'PN 2026-001',
      }, { total: 50_000_000 });
      m.label('loan', loan.id, BANK_LOAN);
    },
  },
  {
    refs: ['G-20b', 'G-21'],
    date: '2026-09-23',
    title: 'G-20 first instalment; G-21 heat press',
    facts: [
      'G-20b loan payment: instalment 1 of the Sample Bank loan, ₱25,000.00 from BDO (paid early).',
      `G-21 fixed asset "${HEAT_PRESS}" (machinery) from ${MACHINES}, invoice SI-2001 of 2026-09-23: ₱112,000.00 VAT-inclusive (VAT ₱12,000.00 shown); ₱30,000.00 paid from BDO, ₱82,000.00 financed by Sample Equipment Finance ("${FINANCING}"), who paid the supplier. Residual ₱10,000.00, life 60 months; the month bought is its first month of depreciation.`,
    ],
    async run(m) {
      await m.on(this.date);
      await m.post('G-20b', 'loan.payment', { loanId: m.doc('G-20').id, instalmentNo: 1, cashPlaceId: m.places['1111'] }, { who: 'enc', total: 2_500_000 });
      const press = await m.post('G-21', 'fa.buy', {
        classCode: 'machinery', description: HEAT_PRESS, location: 'Production floor', supplierId: m.ids[MACHINES], supplierInvoiceNo: 'SI-2001', supplierInvoiceDate: this.date,
        amountCents: 11_200_000, residualCents: 1_000_000, cashPlaceId: m.places['1111'], paidCents: 3_000_000, financedCents: 8_200_000, lender: 'Sample Equipment Finance',
      }, { total: 11_200_000 });
      m.label('asset', press.id, HEAT_PRESS);
      m.label('loan', press.id, FINANCING); // the financing is a loan whose party is the purchase (LOAN public.ts)
    },
  },
  {
    refs: ['G-04a', 'G-04b'],
    date: '2026-09-24',
    title: 'G-04 Downpayment and release in downpayment VAT mode B',
    facts: [
      'Settings: from 2026-09-24 the downpayment VAT mode is B (VAT on deposit), set by the accountant.',
      `JO-000008 for ${SCHOOL}: 20 made-to-order team jersey sets × ₱2,800.00 = ₱56,000.00 (no journal).`,
      'G-04a collection, CR 0109: downpayment ₱28,000.00 in cash on hand, applied to JO-000008 (not yet invoiced).',
      'G-04b: all 20 pieces of JO-000008 released on credit with manual invoice no. 0508 (₱56,000.00, VAT-inclusive, one made-to-order line). The ₱28,000.00 deposit is applied.',
    ],
    async run(m) {
      await m.on(this.date);
      await m.stepUp();
      await m.call('/api/settings/sales.deposit_vat_mode', { effectiveFrom: this.date, value: 'B', reason: 'Accountant sets mode B for the month test' });
      m.ids.jo8 = await jobOrder(m, [{ qty: 20, unitPriceCents: 280_000 }]);
      await collection(m, 'G-04a', { customerId: m.ids[SCHOOL], crNumber: '0109', applications: [{ jobOrderId: m.ids.jo8, amountCents: 2_800_000 }], tenders: [{ cashPlaceId: m.places['1101'], amountCents: 2_800_000 }] }, 2_800_000);
      await releaseWithInvoice(m, 'G-04b', m.ids.jo8, 20, '0508', 5_600_000);
    },
  },
  {
    refs: ['G-05a', 'G-05b', 'G-05c'],
    date: '2026-09-25',
    title: 'G-05 Downpayment invoice, collection and release in downpayment VAT mode C; back to mode A from 26 September',
    facts: [
      'Settings: from 2026-09-25 the downpayment VAT mode is C (invoice on downpayment); from 2026-09-26 it is A (deposit only) again.',
      `JO-000009 for ${SCHOOL}: 20 made-to-order team jersey sets × ₱2,800.00 = ₱56,000.00 (no journal).`,
      'G-05a: the ₱28,000.00 downpayment of JO-000009 is invoiced when received, on manual invoice no. 0509 (a downpayment invoice record).',
      'G-05b collection, CR 0110: ₱28,000.00 in cash on hand, applied to JO-000009 (it pays invoice 0509). No tax withheld.',
      'G-05c: all 20 pieces of JO-000009 released on credit with manual invoice no. 0510 for the balance: the ₱56,000.00 sale less the ₱28,000.00 downpayment invoiced on 0509.',
    ],
    async run(m) {
      await m.on(this.date);
      await m.stepUp();
      await m.call('/api/settings/sales.deposit_vat_mode', { effectiveFrom: this.date, value: 'C', reason: 'Accountant sets mode C for the month test' });
      m.ids.jo9 = await jobOrder(m, [{ qty: 20, unitPriceCents: 280_000 }]);
      await m.post('G-05a', 'jo.dp_invoice', { jobOrderId: m.ids.jo9, invoiceNumber: '0509', amountCents: 2_800_000 }, { who: 'enc', total: 2_800_000 });
      await collection(m, 'G-05b', { customerId: m.ids[SCHOOL], crNumber: '0110', applications: [{ jobOrderId: m.ids.jo9, amountCents: 2_800_000 }], tenders: [{ cashPlaceId: m.places['1101'], amountCents: 2_800_000 }] }, 2_800_000);
      await releaseWithInvoice(m, 'G-05c', m.ids.jo9, 20, '0510', 5_600_000);
      await m.call('/api/settings/sales.deposit_vat_mode', { effectiveFrom: '2026-09-26', value: 'A', reason: 'Back to deposit only (mode A), the default' });
    },
  },
  {
    refs: ['G-23'],
    date: '2026-09-25',
    title: 'G-23 cash advance',
    facts: [`G-23 cash advance: ₱2,000.00 in cash on hand to ${ANA}, ₱1,000.00 deducted each payroll.`],
    async run(m) {
      await m.on(this.date);
      await m.post('G-23', 'ca.advance', { employeeId: m.ids[ANA], cashPlaceId: m.places['1101'], amountCents: 200_000, installmentCents: 100_000 }, { total: 200_000 });
    },
  },
  {
    refs: [],
    date: '2026-09-26',
    title: 'Attendance (no journal)',
    facts: [`${ANA} worked 16, 17, 18, 19, 21 (with 2 hours overtime), 22, 23, 24, 25 and 26 September: 10 days. The 20th is a Sunday, her rest day; no holidays.`],
    async run(m) {
      await m.on(this.date);
      const days = ['16', '17', '18', '19', '21', '22', '23', '24', '25', '26'].map((d) => ({ employeeId: m.ids[ANA], date: `2026-09-${d}`, status: 'present', ...(d === '21' ? { otMinutes: 120 } : {}) }));
      await m.call('/api/emp/attendance', { days }, 'acc');
    },
  },
  {
    refs: ['G-22', 'G-24', 'G-23b', 'S-03', 'S-04'],
    date: '2026-09-30',
    title: 'G-22 inventory count; G-24 and G-23 payroll cutoff 2',
    facts: [
      'G-22 inventory count of materials and supplies at the month end: cotton twill 200 yards at ₱120.00 and 20 thread cones at ₱50.00 = ₱25,000.00 (costs from the supplier\'s price list). No inventory was opened at the cut-over.',
      `G-24 payroll run, semi-monthly (monthly staff) group, 16–30 September: ${CARLA} (SSS and Pag-IBIG trued up to the month's pay; PhilHealth already taken).`,
      `G-23b payroll run, semi-monthly daily-paid group, 16–30 September: ${ANA} (her attendance above, overtime at 125% of the hourly rate of ₱550.00 ÷ 8; her first run of the month, so PhilHealth on the daily-paid basis of F1 is taken whole; the ₱1,000.00 cash-advance instalment is deducted).`,
      `S-03 payroll release of G-24: ${CARLA}'s net pay from cash on hand.`,
      `S-04 payroll release of G-23b: ${ANA}'s net pay from cash on hand.`,
    ],
    async run(m) {
      await m.on(this.date);
      const reason = { costReason: "The supplier's current price list" };
      await m.post('G-22', 'inv.count', { category: 'materials', lines: [{ supplyId: m.ids['Cotton twill'], qty: 200_000, unitCostCents: 12_000, ...reason }, { supplyId: m.ids['Thread cone'], qty: 20, unitCostCents: 5_000, ...reason }] }, { total: 2_500_000 });
      const office = await m.post('G-24', 'pay.run', { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
      const daily = await m.post('G-23b', 'pay.run', { payGroup: 'SEMI_DAILY', periodStart: '2026-09-16' });
      await payOut(m, 'S-03', office.id, [CARLA]);
      await payOut(m, 'S-04', daily.id, [ANA]);
    },
  },
  {
    refs: ['M-01', 'M-02', 'M-03', 'M-04', 'M-05', 'M-06', 'M-07', 'M-08'],
    date: '2026-09-30',
    title: 'Month-end',
    facts: [
      'M-01 depreciation run for September 2026 (both machines).',
      'M-02 cash count of cash on hand: ₱125,470.21 counted (125 × ₱1,000, 4 × ₱100, 1 × ₱50, 1 × ₱20, 4 × 5 centavos, 1 × 1 centavo).',
      'M-03 remittance from BDO: SSS contributions for September 2026, the full amount (no withholding tax on compensation was withheld, so there is no 1601-C).',
      'M-04 remittance from BDO: PhilHealth contributions for September 2026, the full amount.',
      'M-05 remittance from BDO: Pag-IBIG contributions for September 2026, the full amount.',
      "M-06 BIR payment from BDO: the 1601-EQ for Q3 2026, all EWT withheld in the quarter. (September is the third month of the quarter, which has no 0619-E.)",
      'M-07 VAT close of Q3 2026 by the accountant (the 2307 for the VAT withheld is in hand; nothing carried over from before).',
      'M-08 BIR payment from BDO: the 2550Q for Q3 2026, all the VAT payable.',
    ],
    async run(m) {
      await m.on(this.date);
      await m.post('M-01', 'fa.depreciation', { month: '2026-09' });
      const lines = [[100_000, 125], [10_000, 4], [5_000, 1], [2_000, 1], [5, 4], [1, 1]].map(([denominationCents, qty]) => ({ denominationCents, qty }));
      await m.post('M-02', 'cash.count', { cashPlaceId: m.places['1101'], lines }, { total: 12_547_021 });
      // The amounts on the SSS, PhilHealth and Pag-IBIG forms: the month's contributions of both payrolls (worked in the test).
      for (const [ref, scheme, amountCents] of [['M-03', 'SSS', 311_500], ['M-04', 'PHIC', 146_730], ['M-05', 'HDMF', 62_688]] as const) {
        await m.post(ref, 'stat.remittance', { scheme, month: '2026-09', cashPlaceId: m.places['1111'], amountCents, reference: `PRN-${scheme}-2026-09` }, { total: amountCents });
      }
      await m.refused('0619-E', 'tax.bir_payment', { form: '0619-E', period: '2026-09', cashPlaceId: m.places['1111'], amountCents: 378_571, reference: 'EFPS-0619E-2026-09' }, 'THIRD_MONTH');
      await m.post('M-06', 'tax.bir_payment', { form: '1601-EQ', period: '2026-Q3', cashPlaceId: m.places['1111'], amountCents: 378_571, reference: 'EFPS-1601EQ-2026-Q3' }, { total: 378_571 });
      await m.post('M-07', 'tax.vat_close', { year: 2026, quarter: 3 });
      await m.post('M-08', 'tax.bir_payment', { form: '2550Q', period: '2026-Q3', cashPlaceId: m.places['1111'], amountCents: 1_556_608, reference: 'EFPS-2550Q-2026-Q3' }, { total: 1_556_608 });
    },
  },
];

/** Pays a run's net pay to the named people from cash on hand (PAY-REL). */
async function payOut(m: Month, ref: string, runId: string, names: string[]) {
  const run = await m.get(`/api/docs/pay.run/${runId}`);
  const employees = (run.doc.employees as { employeeId: string; netCents: number }[]).filter((e) => names.some((n) => m.ids[n] === e.employeeId));
  const net = employees.reduce((s, e) => s + e.netCents, 0);
  await m.post(ref, 'pay.release', { runId, employeeIds: employees.map((e) => e.employeeId), tenders: [{ cashPlaceId: m.places['1101'], amountCents: net }] }, { total: net });
}

/** Runs the whole month on a fresh in-memory shop and returns it. */
export async function runMonth(): Promise<Month> {
  const env = await createTestEnv(`${CUTOVER}T02:00:00Z`);
  const m = new Month(env);
  for (const step of STEPS) {
    try {
      await step.run.call(step, m);
    } catch (e) {
      throw new Error(`${step.title}: ${(e as Error).message}`);
    }
  }
  return m;
}

/** The app's journals in the blind-recompute CSV's terms: parties only on subledger accounts, no base or rate. */
export const asBlindRows = (rows: JournalRow[]): BlindRow[] =>
  rows.map((r) => ({
    docRef: r.ref, line: r.line, accountCode: r.accountCode, debitCents: r.debitCents, creditCents: r.creditCents,
    party: PARTY_ACCOUNTS.has(r.accountCode) ? r.party : '', taxKind: r.taxKind, baseCents: null, rateBp: null,
  }));

/** "56,000.00" for 5_600_000. */
export const money = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
