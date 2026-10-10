/**
 * A disposable training shop (PLAN C8 "Practice mode"). All master records and documents are made through
 * the same HTTP routes used by staff; reads below are only for safety and reports.
 *   npm run practice-data -- --db <path> --days 60 [--start 2026-09-01]
 * The shop PC's practice mode (shop.ts) runs this file in a child process to build its practice database.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { manilaDate } from '@moonproject/shared';
import { buildApp } from '../../app.ts';
import { fixedClock, today } from '../clock.ts';
import { openDb, type Db } from '../db/driver.ts';
import { loadModules } from '../../modules/load.ts';
import { runInvariants } from '../../engine/ledger/invariants.ts';
import { periodEndOf, periodRuleOf, semiStartOf, weekStartOf } from '../../modules/PAY/run-calc.ts';
import { SESSION_COOKIE } from '../../engine/security/sessions.ts';

export const DAY_MS = 86_400_000;
/** The made-up users' passwords are random and thrown away, so a cheap hash keeps the build quick (the cost is in each hash). */
export const PRACTICE_SCRYPT_N = 2 ** 10;
/** The ongoing team orders (the owner's request, Oct 2026): taken over the last days, made through these steps, not released. */
const ONGOING_DAYS = 12;
const [PRINTING, CUTTING, SEWING, PACKING] = [2, 4, 6, 8];
const ROUTE = [PRINTING, CUTTING, SEWING, PACKING];
const PLAYERS = ['Practice Player A', 'Practice Player B', 'Practice Player C', 'Practice Player D', 'Practice Player E', 'Practice Player F', 'Practice Player G', 'Practice Player H'];
const SIZES = ['S', 'M', 'L', 'XL'];
/**
 * Payrolls left for people to run by hand (the owner's request, Oct 2026): a run whose period ends in the last days of the
 * history is not recorded, so the latest weekly and semi-monthly runs are there to try.
 */
const MANUAL_PAY_DAYS = 10;
export const ROLES = ['owner', 'accountant', 'encoder', 'production'] as const;
export type Role = typeof ROLES[number];
export type Json = Record<string, any>;

export interface Client {
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, body: unknown, headers?: Record<string, string>): Promise<LightMyRequestResponse>;
  put(url: string, body: unknown, headers?: Record<string, string>): Promise<LightMyRequestResponse>;
}

export interface PracticeSummary {
  days: number;
  passwords: Record<Role, string>;
  documents: Record<string, number>;
  cashPlaces: { name: string; balanceCents: number }[];
}

export function ok(response: LightMyRequestResponse, action: string): Json {
  if (response.statusCode !== 200) throw new Error(`${action}: HTTP ${response.statusCode} ${response.body}`);
  return response.json() as Json;
}

export function client(app: FastifyInstance, response: LightMyRequestResponse): Client {
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('The app did not issue a session cookie.');
  const cookies = { [SESSION_COOKIE]: cookie.value };
  const csrf = (response.json() as Json).csrfToken as string;
  const send = (method: 'POST' | 'PUT') => (url: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url, cookies, payload: body as object, headers: { 'x-csrf-token': csrf, ...headers } });
  return {
    get: (url) => app.inject({ method: 'GET', url, cookies }),
    post: send('POST'),
    put: send('PUT'),
  };
}

export async function signIn(app: FastifyInstance, role: Role, password: string): Promise<Client> {
  return client(app, await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: `practice-${role}`, password } }));
}

export async function record(who: Client, type: string, input: object): Promise<Json> {
  const preview = ok(await who.post(`/api/docs/${type}/preview`, { input }), `${type} preview`);
  const errors = (preview.issues as { level: string; code: string; message: string }[]).filter((x) => x.level === 'error');
  if (errors.length) throw new Error(`${type}: ${JSON.stringify(errors)}`);
  return ok(await who.post(`/api/docs/${type}/post`, { input, expectedTotalCents: preview.totalCents },
    { 'idempotency-key': randomUUID() }), `${type} post`);
}

export function cashBalance(db: Db, accountId: number): number {
  return (db.prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS balance
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    WHERE j.sealed = 1 AND l.account_id = ?`).get(accountId) as { balance: number }).balance;
}

export function denominations(cents: number): { denominationCents: number; qty: number }[] {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`Cannot count a negative or invalid till: ${cents}`);
  let left = cents;
  const lines: { denominationCents: number; qty: number }[] = [];
  for (const denominationCents of [100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 100, 25, 5, 1]) {
    const qty = Math.floor(left / denominationCents);
    if (qty) lines.push({ denominationCents, qty });
    left -= qty * denominationCents;
  }
  return lines;
}

export function quarter(date: string): { year: number; quarter: number } {
  const [year, month] = date.split('-').map(Number);
  return { year: year!, quarter: Math.ceil(month! / 3) };
}

/**
 * Creates a standalone database. A populated or otherwise nonempty file is
 * rejected before app startup can run migrations against it.
 */
export async function createPracticeData(dbPath: string, days: number, start = '2026-09-01'): Promise<PracticeSummary> {
  if (!Number.isSafeInteger(days) || days < 1 || days > 366) throw new Error('--days must be an integer from 1 to 366.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(`${start}T00:00:00Z`))) throw new Error('--start must be a date like 2026-09-01.');
  const START = Date.parse(`${start}T02:00:00Z`); // 10 a.m. in Manila on the first day
  const hired = manilaDate(new Date(START - 31 * DAY_MS)); // the made-up employees started a month before
  if (!dbPath || dbPath === ':memory:') throw new Error('--db must name a new database file.');
  const file = resolve(dbPath);
  if (existsSync(file) && statSync(file).size > 0) throw new Error(`Refusing ${file}: the file is not empty and may already contain documents.`);
  const db = openDb(file);
  const clock = fixedClock(new Date(START).toISOString());
  let app: FastifyInstance | undefined;
  try {
    const built = buildApp({ db, clock, modules: await loadModules(), config: { scryptN: PRACTICE_SCRYPT_N } });
    app = built.app;
    await app.ready();
    if ((db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n !== 0) throw new Error('Refusing a database that already has documents.');

    const passwords = {} as Record<Role, string>;
    for (const role of ROLES) passwords[role] = `Practice7-${role}-${randomBytes(12).toString('base64url')}!`;
    ok(await app.inject({ method: 'POST', url: '/api/setup/first-owner', payload: {
      username: 'practice-owner', displayName: 'Practice Owner', password: passwords.owner,
    } }), 'create practice owner');
    let owner = await signIn(app, 'owner', passwords.owner);
    ok(await owner.post('/api/auth/step-up', { password: passwords.owner }), 'owner step-up');
    for (const role of ROLES.slice(1)) {
      ok(await owner.post('/api/users', {
        username: `practice-${role}`, displayName: `Practice ${role}`,
        roles: [role], temporaryPassword: passwords[role],
      }), `create ${role}`);
      const temporary = await signIn(app, role, passwords[role]);
      const newPassword = `Practice8-${role}-${randomBytes(12).toString('base64url')}!`;
      ok(await temporary.post('/api/auth/change-password', {
        currentPassword: passwords[role], newPassword,
      }), `activate ${role}`);
      passwords[role] = newPassword;
    }

    ok(await owner.put('/api/prt/company-profile', {
      registeredName: 'Practice Garments (Fictional) Corp.',
      tradeName: 'Practice Garments',
      tin: '000-000-000-000',
      registeredAddress: '1 Practice Lane, Sample City, Philippines',
      isVatRegistered: true,
    }, { 'if-match': '0' }), 'company profile');

    const till = ok(await owner.post('/api/cash/places', {
      name: 'Practice counter till', kind: 'cash', encoderSeesBalance: true,
    }), 'create till').id as number;
    const bank = ok(await owner.post('/api/cash/places', {
      name: 'Practice bank', kind: 'bank', encoderSeesBalance: false,
    }), 'create bank').id as number;
    const supplier = ok(await owner.post('/api/pur/suppliers', {
      name: 'Practice Fabric Supplier', registeredName: 'Practice Fabric Supplier (Fictional)',
      tin: '000-000-001-000', isVatRegistered: true, paymentTermsDays: 30,
    }), 'create supplier').id as string;
    const utility = ok(await owner.post('/api/pur/suppliers', {
      name: 'Practice Utilities', registeredName: 'Practice Utilities (Fictional)',
      tin: '000-000-002-000', isVatRegistered: false,
    }), 'create utilities supplier').id as string;
    const cloth = ok(await owner.post('/api/pur/supplies', {
      name: 'Practice cotton cloth', unit: 'yard', category: 'materials',
    }), 'create supply').id as string;
    const item = ok(await owner.post('/api/cat/items', {
      code: 'PRACTICE-PATCH', name: 'Practice name patch', class: 'service',
      garmentType: null, unit: 'pc', setComponents: 1,
    }), 'create catalogue item').id as string;
    ok(await owner.post(`/api/cat/items/${item}/prices`, {
      effectiveFrom: start, minQty: 1, unitPriceCents: 10_000,
    }, { 'if-match': '1' }), 'price catalogue item');
    const customers: string[] = [];
    const team = new Map<string, string[]>(); // each customer's team of wearers, for the ongoing team orders
    for (let n = 1; n <= 4; n++) {
      const customer = ok(await owner.post('/api/cus/customers', {
        kind: 'organization', displayName: `Practice Customer ${n}`,
        registeredName: `Practice Customer ${n} (Fictional)`,
        tin: `000-000-${String(n + 10).padStart(3, '0')}-000`,
        isVatRegistered: n % 2 === 0,
      }), `create customer ${n}`);
      customers.push(customer.id as string);
      const person = ok(await owner.post(`/api/cus/customers/${customer.id}/people`, {
        fullName: `Practice Wearer ${n}`,
      }), `create wearer ${n}`);
      ok(await owner.post(`/api/cus/people/${person.id}/measurements`, {
        sizeMode: 'measured', values: { chest: 36 + n, upperWaist: 30 + n },
        remarks: 'Made-up training measurements',
      }), `measure wearer ${n}`);
      const players: string[] = [];
      for (const name of PLAYERS) players.push(ok(await owner.post(`/api/cus/customers/${customer.id}/people`, { fullName: `${name} ${n}` }), `create player ${name} ${n}`).id as string);
      team.set(customer.id as string, players);
    }
    const office = ok(await owner.post('/api/emp/employees', {
      fullName: 'Practice Office Employee', costCentre: 'office',
      hireDate: hired, position: 'Practice clerk',
    }), 'create office employee').id as string;
    const sewer = ok(await owner.post('/api/emp/employees', {
      fullName: 'Practice Production Employee', costCentre: 'production',
      hireDate: hired, position: 'Practice sewer',
    }), 'create production employee').id as string;
    ok(await owner.post(`/api/emp/employees/${office}/pay`, {
      effectiveFrom: hired, payType: 'monthly', monthlyRateCents: 1_500_000,
      payGroup: 'SEMI_MONTHLY', workweekDays: 6, isMwe: false, reason: 'Made-up practice rate',
    }), 'office pay profile');
    ok(await owner.post(`/api/emp/employees/${sewer}/pay`, {
      effectiveFrom: hired, payType: 'piece',
      payGroup: 'WEEKLY_PIECE', workweekDays: 6, isMwe: false, reason: 'Made-up practice rate',
    }), 'production pay profile');
    // More of the floor (the owner's request, Oct 2026): piece-rate cutter and sewer, and daily-paid printer and packer
    // paid every week in their own runs (WEEKLY_DAILY), whose days come from attendance.
    const worker = async (fullName: string, position: string, pay: object) => {
      const id = ok(await owner.post('/api/emp/employees', { fullName, costCentre: 'production', hireDate: hired, position }), `create ${fullName}`).id as string;
      ok(await owner.post(`/api/emp/employees/${id}/pay`, { effectiveFrom: hired, workweekDays: 6, isMwe: false, reason: 'Made-up practice rate', ...pay }), `${fullName} pay profile`);
      return id;
    };
    const cutter = await worker('Practice Cutter', 'Practice cutter', { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
    const sewer2 = await worker('Practice Sewer Two', 'Practice sewer', { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
    const printer = await worker('Practice Printer', 'Practice printer', { payType: 'daily', dailyRateCents: 64_500, payGroup: 'WEEKLY_DAILY' });
    const packer = await worker('Practice Packer', 'Practice packer', { payType: 'daily', dailyRateCents: 61_000, payGroup: 'WEEKLY_DAILY' });
    const helper = await worker('Practice Helper', 'Practice helper', { payType: 'daily', dailyRateCents: 60_000, payGroup: 'SEMI_DAILY' });
    const lastDay = manilaDate(new Date(START + (days - 1) * DAY_MS));
    const onStep: Record<number, string[]> = { [PRINTING]: [printer], [CUTTING]: [cutter], [SEWING]: [sewer, sewer2], [PACKING]: [packer] };
    const ongoing: { id: string; from: number; step: number; done: number }[] = []; // work starts the day after it is routed
    let reworkSent = false;
    const categoryId = (db.prepare(`SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = '6990'`).get() as { id: number }).id;

    for (let day = 0; day < days; day++) {
      clock.set(new Date(START + day * DAY_MS).toISOString());
      const date = today(clock);
      owner = await signIn(app, 'owner', passwords.owner);
      let accountant = await signIn(app, 'accountant', passwords.accountant);
      let encoder = await signIn(app, 'encoder', passwords.encoder);
      const production = await signIn(app, 'production', passwords.production);
      const customerId = customers[day % customers.length]!;
      const serial = day + 1;
      await record(encoder, 'quo.quotation', {
        prospectName: `Practice Customer ${day % customers.length + 1}`,
        lines: [{ itemId: item, description: 'Practice name patches', qty: 5, unit: 'pc' }],
      });
      const jo = await record(encoder, 'jo.job_order', {
        customerId, dueInDays: 7, priority: 'normal', paymentTerms: 'dp50',
        lines: [{ kind: 'made_to_order', description: 'Practice uniform shirts', qty: 5,
          unitPriceCents: 100_000, discountCents: 0, roster: [] }],
      });
      await record(encoder, 'col.collection', {
        customerId, crNumber: String(10_000 + serial * 2),
        applications: [{ jobOrderId: jo.id, amountCents: 250_000 }],
        tenders: [{ cashPlaceId: till, amountCents: 250_000 }],
      });
      ok(await production.post(`/api/prd/jobs/${jo.id}/lines/1/setup`, {
        templateId: 1, stepIds: [6, 8], garmentType: 'T-shirt', complexity: 'standard',
      }), 'set production route');
      // Every step needs all of the line's pieces before it is completed (sewing, then packing).
      for (const stepId of [6, 8]) await record(production, 'prd.entry', {
        jobOrderId: jo.id, stepId, rows: [{ lineNo: 1, employeeId: sewer, pieces: 5 }],
      });
      for (const step of [6, 8]) ok(await production.post(
        `/api/prd/jobs/${jo.id}/lines/1/steps/${step}/complete`, {},
      ), `complete production step ${step}`);
      const release = { jobOrderId: jo.id, lines: [{ lineNo: 1, qty: 5 }],
        claimedBy: `Practice Collector ${serial}`, idSeen: 'other_id',
        creditNote: 'Balance paid at counter', creditDueInDays: 7 };
      ok(await accountant.post('/api/jo/releases', {
        release, invoice: { invoiceNumber: String(50_000 + serial) },
        expectedTotalCents: 500_000,
      }, { 'idempotency-key': randomUUID() }), 'release and invoice record');
      await record(encoder, 'col.collection', {
        customerId, crNumber: String(10_000 + serial * 2 + 1),
        applications: [{ jobOrderId: jo.id, amountCents: 250_000 }],
        tenders: [{ cashPlaceId: till, amountCents: 250_000 }],
      });
      ok(await encoder.post('/api/qs/sales', {
        sale: { customerId, invoiceNumber: String(70_000 + serial),
          lines: [{ kind: 'service', description: 'Practice alteration', qty: 1,
            unitPriceCents: 35_000, discountCents: 0 }] },
        payment: { crNumber: String(90_000 + serial),
          tenders: [{ cashPlaceId: till, amountCents: 35_000 }] },
        expectedTotalCents: 35_000,
      }, { 'idempotency-key': randomUUID() }), 'quick sale');
      const bill = await record(encoder, 'ap.bill', {
        supplierId: supplier, supplierInvoiceNo: `PRACTICE-${serial}`,
        supplierInvoiceDate: date, lines: [{ supplyId: cloth, amountCents: 112_000 }],
      });
      await record(encoder, 'cash.transfer', {
        fromCashPlaceId: till, toCashPlaceId: bank,
        amountSentCents: 100_000, amountReceivedCents: 100_000,
      });
      await record(encoder, 'ap.payment', {
        supplierId: supplier, bills: [{ billId: bill.id, amountCents: 50_000 }],
        tenders: [{ cashPlaceId: bank, amountCents: 50_000 }],
      });
      await record(encoder, 'exp.voucher', {
        categoryId, tenders: [{ cashPlaceId: till, amountCents: 25_000 }], amountCents: 25_000,
        description: 'Practice shop supplies and utilities', supplierId: utility,
        supplierInvoiceNo: `UTIL-${serial}`, supplierInvoiceDate: date,
      });

      // Ongoing work (the owner's request, Oct 2026): over the last days, a team order a day with a wearer list goes
      // Printing → Cutting → Sewing → Packing, four wearers a day, and is not released, so the board has jobs at every
      // step, some ready, one with a jersey sent back for rework, and the newest still to route. Daily-paid staff are
      // present every day but Saturday (their rest day).
      if (day >= days - ONGOING_DAYS) {
        const players = team.get(customerId)!;
        const order = await record(encoder, 'jo.job_order', {
          customerId, dueInDays: 14, priority: day % 3 === 0 ? 'rush' : 'normal', paymentTerms: 'dp50',
          lines: [{ kind: 'made_to_order', description: 'Practice team jersey', qty: players.length, unitPriceCents: 45_000, discountCents: 0,
            roster: players.map((personId, i) => ({ personId, sizeMode: 'preset', size: SIZES[i % SIZES.length], jerseyNumber: String(i + 4), qty: 1 })) }],
        });
        await record(encoder, 'col.collection', {
          customerId, crNumber: String(30_000 + serial),
          applications: [{ jobOrderId: order.id, amountCents: players.length * 22_500 }],
          tenders: [{ cashPlaceId: till, amountCents: players.length * 22_500 }],
        });
        if (day < days - 1) {
          ok(await production.post(`/api/prd/jobs/${order.id}/lines/1/setup`, { templateId: 1, stepIds: ROUTE, garmentType: 'Jersey (NBA cut)', complexity: 'standard' }), 'route a team order');
          ongoing.push({ id: order.id as string, from: day + 1, step: 0, done: 0 });
        }
      }
      for (const o of ongoing.filter((x) => x.from <= day && x.step < ROUTE.length)) {
        const stepId = ROUTE[o.step]!;
        const people = onStep[stepId]!;
        const wearers = [o.done + 1, o.done + 2, o.done + 3, o.done + 4].filter((w) => w <= PLAYERS.length);
        await record(production, 'prd.entry', { jobOrderId: o.id, stepId, rows: [{ lineNo: 1, employeeId: people[day % people.length]!, pieces: wearers.length, wearers }] });
        o.done += wearers.length;
        if (o.done >= PLAYERS.length) (o.step++, (o.done = 0));
        if (!reworkSent && o.step === ROUTE.length) {
          ok(await production.post(`/api/prd/jobs/${o.id}/lines/1/rework`, { wearers: [2], reason: 'Number printed off-centre on the back', foundAtStepId: PACKING }), 'send a jersey back for rework');
          reworkSent = true;
        }
      }
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (weekday !== 6) {
        const holiday = db.prepare('SELECT 1 FROM emp_holidays WHERE holiday_date = ? AND is_active = 1').get(date); // the floor works through it
        const status = holiday ? 'holiday_worked' : 'present';
        // Something to see on the payslips: the printer's overtime on Mondays, the packer's night work on Thursdays, and
        // the helper's absence on Wednesdays, half day on Fridays and overtime on Tuesdays.
        ok(await owner.post('/api/emp/attendance', { days: [
          { employeeId: printer, date, status, ...(weekday === 1 ? { otMinutes: 120 } : {}) },
          { employeeId: packer, date, status, ...(weekday === 4 ? { otMinutes: 60, nightMinutes: 60 } : {}) },
          { employeeId: helper, date, status: holiday ? status : weekday === 3 ? 'absent' : weekday === 5 ? 'half_day' : 'present', ...(weekday === 2 && !holiday ? { otMinutes: 90 } : {}) },
        ] }), 'daily attendance');
      }
      // Cash advances, taken back an installment a payroll: one early on, one in the last week (it shows on the runs left to do).
      if (day === 2) await record(owner, 'ca.advance', { employeeId: sewer2, cashPlaceId: till, amountCents: 100_000, installmentCents: 25_000, note: 'Practice cash advance' });
      if (day === days - 6) await record(owner, 'ca.advance', { employeeId: printer, cashPlaceId: till, amountCents: 60_000, installmentCents: 30_000, note: 'Practice cash advance' });

      // Cutoffs close after the day's work. A weekly piece run is recorded on the
      // last day of its week (Saturday, or Thursday once weeks start on Friday);
      // the office run is recorded on the 15th and month end.
      clock.set(new Date(START + day * DAY_MS + 7 * 3_600_000).toISOString());
      accountant = await signIn(app, 'accountant', passwords.accountant);
      encoder = await signIn(app, 'encoder', passwords.encoder);
      const dayOfMonth = Number(date.slice(8));
      const runs: { payGroup: string; periodStart: string }[] = [];
      const rule = periodRuleOf(db);
      const week = weekStartOf(date, rule);
      if (week && periodEndOf('WEEKLY_PIECE', week, rule) === date) runs.push({ payGroup: 'WEEKLY_PIECE', periodStart: week }, { payGroup: 'WEEKLY_DAILY', periodStart: week });
      const half = semiStartOf(date, rule); // the semi-monthly run closes on its period's last day (the 15th and month end, or the 10th and 25th)
      if (half && periodEndOf('SEMI_MONTHLY', half, rule) === date) runs.push({ payGroup: 'SEMI_MONTHLY', periodStart: half }, { payGroup: 'SEMI_DAILY', periodStart: half });
      const leftToDo = (Date.parse(lastDay) - Date.parse(date)) / DAY_MS < MANUAL_PAY_DAYS && days > MANUAL_PAY_DAYS;
      for (const input of leftToDo ? [] : runs) {
        const run = await record(accountant, 'pay.run', input);
        const slips = ok(await accountant.get(`/api/pay/runs/${run.id}/payslips`), 'payroll slips');
        const people = (slips.employees as { employeeId: string; netCents: number }[]).filter((person) => person.netCents > 0); // paid ones only
        const total = people.reduce((sum, person) => sum + person.netCents, 0);
        // Paid from the till when it holds enough; otherwise the run waits for its release, as payroll does when the cash
        // is not in yet (a practice shop started near a month end has only a day's takings in the till).
        if (total > 0 && total <= cashBalance(db, till)) await record(accountant, 'pay.release', {
          runId: run.id, employeeIds: people.map((person) => person.employeeId),
          tenders: [{ cashPlaceId: till, amountCents: total }],
        });
      }

      const counted = cashBalance(db, till);
      await record(encoder, 'cash.count', {
        cashPlaceId: till, lines: denominations(counted), note: `Practice day ${serial} closing count`,
      });
      // The close is recorded on the following business date, when the
      // previous quarter has actually ended.
      if (day > 0 && dayOfMonth === 1 && [1, 4, 7, 10].includes(Number(date.slice(5, 7)))) {
        const previous = quarter(manilaDate(new Date(START + (day - 1) * DAY_MS)));
        await record(accountant, 'tax.vat_close', previous);
      }
    }
    const failures = runInvariants(db).filter((result) => !result.ok);
    if (failures.length) throw new Error(`Practice data failed invariants: ${JSON.stringify(failures)}`);
    const documents = Object.fromEntries((db.prepare(
      'SELECT doc_type, COUNT(*) AS n FROM documents GROUP BY doc_type ORDER BY doc_type',
    ).all() as { doc_type: string; n: number }[]).map((row) => [row.doc_type, row.n]));
    owner = await signIn(app, 'owner', passwords.owner);
    const cashPlaces = (ok(await owner.get('/api/cash/places'), 'cash position') as unknown as {
      id: number; name: string; balanceCents: number | null;
    }[]).filter((place) => place.balanceCents !== null)
      .map((place) => ({ name: place.name, balanceCents: place.balanceCents! }));
    return { days, passwords, documents, cashPlaces };
  } finally {
    if (app) await app.close();
    db.close();
  }
}

const USAGE = 'Usage: npm run practice-data -- --db <path> --days 60 [--start 2026-09-01] [--quiet]';

function args(argv: string[]): { db: string; days: number; start?: string; quiet: boolean } {
  let db = '';
  let days = 60;
  let start: string | undefined;
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') db = argv[++i] ?? '';
    else if (argv[i] === '--days') days = Number(argv[++i]);
    else if (argv[i] === '--start') start = argv[++i];
    else if (argv[i] === '--quiet') quiet = true; // the shop's practice mode: no passwords in the service log
    else throw new Error(USAGE);
  }
  if (!db) throw new Error(USAGE);
  return { db, days, start, quiet };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { db, days, start, quiet } = args(process.argv.slice(2));
  createPracticeData(db, days, start)
    .then((summary) => {
      if (!quiet) {
        console.log('Practice data created. Save these passwords for training:');
        for (const role of ROLES) console.log(`  practice-${role}: ${summary.passwords[role]}`);
      }
      console.log('Documents:', summary.documents);
      console.log('Cash position (centavos):', summary.cashPlaces);
      console.log('Invariants: clean');
    })
    .catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
