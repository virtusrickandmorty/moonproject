/**
 * Three busy years on one PC (PERF). Builds a database the size a shop reaches after years of use, so the lists and reports can
 * be timed on it (apps/server/perf). Every record is made through the same HTTP routes the screens use, as practice data is
 * (data.ts): nothing is written to a table directly, and the only reads are the till balance and the fingerprint.
 *   npm run perf-data -- [--db data/perf/perf.db] [--seed 1] [--days 1096] [--customers 6000] [--jobs 25000] [--employees 30]
 * The same seed gives the same database: every choice comes from one seeded generator and the clock is fixed, so the documents,
 * numbers, dates and journals are identical run to run (the ids are random, as everywhere, so the fingerprint leaves them out).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { manilaDate } from '@moonproject/shared';
import { buildApp } from '../../app.ts';
import { fixedClock, today } from '../clock.ts';
import { openDb, type Db } from '../db/driver.ts';
import { loadModules } from '../../modules/load.ts';
import { runInvariants } from '../../engine/ledger/invariants.ts';
import {
  DAY_MS, PRACTICE_SCRYPT_N, ROLES, cashBalance, client, denominations, ok, quarter, record,
  type Client, type Json, type Role,
} from './data.ts';

export interface PerfOptions {
  seed: number;
  days: number;
  customers: number;
  jobOrders: number;
  employees: number;
  /** First business date. The starter statutory tables and piece rates in the migrations take effect on 1 January 2026, so payroll can only run from there. */
  start: string;
  /** Called about once a month of shop time. */
  progress?: (line: string) => void;
}

export const PERF_DEFAULTS: Omit<PerfOptions, 'progress'> = {
  seed: 1, days: 1096, customers: 6000, jobOrders: 25000, employees: 30, start: '2026-01-01',
};

export interface PerfSummary {
  options: Omit<PerfOptions, 'progress'>;
  /** Made-up passwords, fixed by the seed: this database holds no real person's data. */
  passwords: Record<Role, string>;
  documents: Record<string, number>;
  customers: number;
  employees: number;
  /** SHA-256 over every document and journal line without their random ids: equal for equal seeds. */
  fingerprint: string;
}

/** A small, fast, seedable generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURNAMES = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Flores', 'Ramos',
  'Aquino', 'Castillo', 'Villanueva', 'Navarro', 'Domingo', 'Salazar', 'Delos Reyes', 'Pascual', 'Soriano', 'Valdez'];
const TRADES = ['Trading', 'Elementary School', 'Security Agency', 'Restaurant', 'Cooperative', 'Hardware', 'Clinic', 'Bakery',
  'Transport', 'Realty', 'Sports Club', 'Motors', 'Catering', 'Dental', 'Learning Center'];
const GIVEN = ['Ana', 'Ben', 'Carla', 'Dante', 'Elena', 'Felix', 'Gina', 'Hugo', 'Iris', 'Jose', 'Kara', 'Luis', 'Mia', 'Nico', 'Olga'];

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const tin = (n: number) => `000-${pad(Math.floor(n / 1000) % 1000, 3)}-${pad(n % 1000, 3)}-000`;
/** How many of `total` fall on day `d` of `days`: spreads them evenly and sums to exactly `total`. */
const share = (total: number, days: number, d: number) => Math.floor(((d + 1) * total) / days) - Math.floor((d * total) / days);

interface Job { id: string; customerId: string; qty: number; totalCents: number; serial: number }

/** Creates the database at `dbPath` (a new file) and returns what it holds. */
export async function createPerfData(dbPath: string, given: Partial<PerfOptions> = {}): Promise<PerfSummary> {
  const opts = { ...PERF_DEFAULTS, ...given };
  for (const k of ['days', 'customers', 'jobOrders', 'employees'] as const)
    if (!Number.isSafeInteger(opts[k]) || opts[k] < 1) throw new Error(`--${k} must be a whole number of 1 or more.`);
  if (!Number.isSafeInteger(opts.seed)) throw new Error('--seed must be a whole number.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.start) || Number.isNaN(Date.parse(`${opts.start}T00:00:00Z`))) throw new Error('--start must be a date like 2026-01-01.');
  const { days, seed } = opts;
  if (!dbPath || dbPath === ':memory:') throw new Error('--db must name a new database file.');
  const file = resolve(dbPath);
  if (existsSync(file) && statSync(file).size > 0) throw new Error(`Refusing ${file}: the file is not empty and may already contain documents.`);
  mkdirSync(dirname(file), { recursive: true });
  const START = Date.parse(`${opts.start}T02:00:00Z`); // 10 a.m. in Manila on the first day
  const hired = manilaDate(new Date(START - 31 * DAY_MS));
  const rand = seeded(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const db = openDb(file);
  // This file is thrown away if the build dies, so it does not wait for the disk on every one of its few hundred thousand commits.
  db.pragma('synchronous = OFF');
  const clock = fixedClock(new Date(START).toISOString());
  let app: FastifyInstance | undefined;
  try {
    const built = buildApp({ db, clock, modules: await loadModules(), config: { scryptN: PRACTICE_SCRYPT_N } });
    app = built.app;
    await app.ready();
    if ((db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n !== 0) throw new Error('Refusing a database that already has documents.');

    const passwords = {} as Record<Role, string>;
    for (const role of ROLES) passwords[role] = `Perf7-${role}-seed${seed}-fixture!`;
    ok(await app.inject({ method: 'POST', url: '/api/setup/first-owner', payload: {
      username: 'perf-owner', displayName: 'Perf Owner', password: passwords.owner,
    } }), 'create owner');
    const login = async (role: Role) => signInAs(app!, role, passwords[role]);
    let owner = await login('owner');
    ok(await owner.post('/api/auth/step-up', { password: passwords.owner }), 'owner step-up');
    for (const role of ROLES.slice(1)) {
      ok(await owner.post('/api/users', { username: `perf-${role}`, displayName: `Perf ${role}`, roles: [role], temporaryPassword: `Perf6-${role}-temporary-fixture!` }), `create ${role}`);
      const temporary = await signInAs(app, role, `Perf6-${role}-temporary-fixture!`);
      ok(await temporary.post('/api/auth/change-password', { currentPassword: `Perf6-${role}-temporary-fixture!`, newPassword: passwords[role] }), `activate ${role}`);
    }
    ok(await owner.put('/api/prt/company-profile', {
      registeredName: 'Perf Garments (Fictional) Corp.', tradeName: 'Perf Garments', tin: '000-000-000-000',
      registeredAddress: '1 Practice Lane, Sample City, Philippines', isVatRegistered: true,
    }, { 'if-match': '0' }), 'company profile');

    const till = ok(await owner.post('/api/cash/places', { name: 'Perf counter till', kind: 'cash', encoderSeesBalance: true }), 'till').id as number;
    const bank = ok(await owner.post('/api/cash/places', { name: 'Perf bank', kind: 'bank', encoderSeesBalance: false }), 'bank').id as number;
    const supplier = ok(await owner.post('/api/pur/suppliers', {
      name: 'Perf Fabric Supplier', registeredName: 'Perf Fabric Supplier (Fictional)', tin: '000-000-001-000', isVatRegistered: true, paymentTermsDays: 30,
    }), 'supplier').id as string;
    const utility = ok(await owner.post('/api/pur/suppliers', {
      name: 'Perf Utilities', registeredName: 'Perf Utilities (Fictional)', tin: '000-000-002-000', isVatRegistered: false,
    }), 'utilities').id as string;
    const cloth = ok(await owner.post('/api/pur/supplies', { name: 'Perf cotton cloth', unit: 'yard', category: 'materials' }), 'supply').id as string;
    const item = ok(await owner.post('/api/cat/items', {
      code: 'PERF-PATCH', name: 'Perf name patch', class: 'service', garmentType: null, unit: 'pc', setComponents: 1,
    }), 'item').id as string;
    ok(await owner.post(`/api/cat/items/${item}/prices`, { effectiveFrom: opts.start, minQty: 1, unitPriceCents: 10_000 }, { 'if-match': '1' }), 'price');
    const categoryId = (db.prepare(`SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = '6990'`).get() as { id: number }).id;

    // The staff: paid twice a month. The production people are the ones the daily entries are recorded against.
    const staff: { id: string; production: boolean }[] = [];
    for (let n = 0; n < opts.employees; n++) {
      const production = n >= Math.ceil(opts.employees / 3);
      const id = ok(await owner.post('/api/emp/employees', {
        fullName: `${GIVEN[n % GIVEN.length]} ${SURNAMES[(n * 7) % SURNAMES.length]} ${pad(n + 1, 2)}`,
        costCentre: production ? 'production' : 'office', hireDate: hired, position: production ? 'Sewer' : 'Clerk',
      }), `employee ${n}`).id as string;
      ok(await owner.post(`/api/emp/employees/${id}/pay`, {
        effectiveFrom: hired, payType: 'monthly', monthlyRateCents: 1_400_000 + (n % 10) * 50_000,
        payGroup: 'SEMI_MONTHLY', workweekDays: 6, isMwe: false, reason: 'Made-up perf rate',
      }), `pay ${n}`);
      staff.push({ id, production });
    }
    const sewers = staff.filter((s) => s.production).map((s) => s.id);

    const customers: string[] = [];
    const queue = <T>() => new Map<number, T[]>();
    const later = <T>(q: Map<number, T[]>, day: number, x: T) => { if (day < days) (q.get(day) ?? q.set(day, []).get(day)!).push(x); };
    const toProduce = queue<Job>(); const toRelease = queue<Job>(); const toCollect = queue<Job>();
    const recentFrom = Math.floor(days * 0.85);
    const opening = Math.min(opts.customers, 10); // the shop's first customers are there on day one
    let jobSerial = 0; let cr = 100_000; let invoiceNo = 500_000; let saleNo = 900_000;
    let billNo = 0; const billsToPay: { id: string; amountCents: number }[] = [];
    const post = async (who: Client, type: string, input: object, expectedTotalCents: number) => ok(await who.post(`/api/docs/${type}/post`,
      { input, expectedTotalCents }, { 'idempotency-key': randomUUID() }), `${type} post`);
    const collect = (who: Client, customerId: string, jobOrderId: string, amountCents: number) => post(who, 'col.collection', {
      customerId, crNumber: String(cr++), applications: [{ jobOrderId, amountCents }],
      tenders: [{ cashPlaceId: rand() < 0.8 ? till : bank, amountCents }],
    }, amountCents);

    for (let day = 0; day < days; day++) {
      clock.set(new Date(START + day * DAY_MS).toISOString());
      const date = today(clock);
      owner = await login('owner');
      let accountant = await login('accountant');
      let encoder = await login('encoder');
      const production = await login('production');

      for (let c = (day === 0 ? opening : 0) + share(opts.customers - opening, days, day); c > 0; c--) {
        const n = customers.length + 1;
        const name = `${SURNAMES[int(0, SURNAMES.length - 1)]} ${TRADES[int(0, TRADES.length - 1)]} ${pad(n, 4)}`;
        const person = int(0, 9) < 3;
        const customer = ok(await owner.post('/api/cus/customers', person
          ? { kind: 'person', displayName: `${GIVEN[int(0, GIVEN.length - 1)]} ${SURNAMES[int(0, SURNAMES.length - 1)]} ${pad(n, 4)}`, isVatRegistered: false }
          : { kind: 'organization', displayName: name, registeredName: `${name} (Fictional)`, tin: tin(n), isVatRegistered: n % 2 === 0 }), `customer ${n}`);
        customers.push(customer.id as string);
        const wearer = ok(await owner.post(`/api/cus/customers/${customer.id}/people`, { fullName: `${GIVEN[n % GIVEN.length]} ${SURNAMES[n % SURNAMES.length]} (wearer ${n})` }), `wearer ${n}`);
        ok(await owner.post(`/api/cus/people/${wearer.id}/measurements`, {
          sizeMode: 'measured', values: { chest: 32 + (n % 14), upperWaist: 26 + (n % 12) }, remarks: 'Made-up measurements',
        }), `measure ${n}`);
      }

      // New job orders: the order and its deposit today, the route set up for production.
      for (let j = share(opts.jobOrders, days, day); j > 0; j--) {
        const serial = ++jobSerial;
        const customerId = customers[Math.floor(rand() ** 1.5 * customers.length)]!;
        const qty = int(6, 60);
        const unitPriceCents = int(15, 60) * 1_000; // ₱150 to ₱600 a piece
        const totalCents = qty * unitPriceCents;
        if (serial % 5 === 0) await record(encoder, 'quo.quotation', {
          prospectName: `Perf prospect ${serial}`, lines: [{ itemId: item, description: 'Perf name patches', qty: 5, unit: 'pc' }],
        });
        const jo = await post(encoder, 'jo.job_order', {
          customerId, dueInDays: int(5, 21), priority: rand() < 0.1 ? 'rush' : 'normal', paymentTerms: 'dp50',
          lines: [{ kind: 'made_to_order', description: `Perf uniform ${serial}`, qty, unitPriceCents, discountCents: 0, roster: [] }],
        }, totalCents);
        const job: Job = { id: jo.id as string, customerId, qty, totalCents, serial };
        await collect(encoder, customerId, job.id, totalCents / 2);
        ok(await production.post(`/api/prd/jobs/${job.id}/lines/1/setup`, {
          templateId: 1, stepIds: [6, 8], garmentType: 'T-shirt', complexity: 'standard',
        }), 'set production route');
        later(toProduce, day + int(1, 6), job);
      }

      // Production: the day's entries, then the steps done.
      for (const job of toProduce.get(day) ?? []) {
        const first = sewers[int(0, sewers.length - 1)]!;
        const second = sewers[(sewers.indexOf(first) + 1) % sewers.length]!;
        const a = Math.floor(job.qty / 2);
        await record(production, 'prd.entry', { jobOrderId: job.id, stepId: 6, rows: [
          { lineNo: 1, employeeId: first, pieces: a }, { lineNo: 1, employeeId: second, pieces: job.qty - a }] });
        for (const step of [6, 8]) ok(await production.post(`/api/prd/jobs/${job.id}/lines/1/steps/${step}/complete`, {}), `complete step ${step}`);
        later(toRelease, day + int(0, 8), job);
      }

      // Release and invoice; most customers then pay the balance, the recent ones less often.
      for (const job of toRelease.get(day) ?? []) {
        ok(await accountant.post('/api/jo/releases', {
          release: { jobOrderId: job.id, lines: [{ lineNo: 1, qty: job.qty }], claimedBy: `Perf Collector ${job.serial}`, idSeen: 'other_id',
            creditNote: 'Balance on credit', creditDueInDays: 7 },
          invoice: { invoiceNumber: String(invoiceNo++) }, expectedTotalCents: job.totalCents,
        }, { 'idempotency-key': randomUUID() }), 'release and invoice record');
        if (rand() < (day < recentFrom ? 0.64 : 0.15)) later(toCollect, day + int(0, 25), job);
      }
      for (const job of toCollect.get(day) ?? []) await collect(encoder, job.customerId, job.id, job.totalCents / 2);

      // The counter: a quick sale and an expense every day, a supplier bill every other day, money to the bank each week.
      saleNo++;
      await ok0(encoder, '/api/qs/sales', {
        sale: { customerId: customers[int(0, customers.length - 1)]!, invoiceNumber: String(saleNo),
          lines: [{ kind: 'service', description: 'Perf alteration', qty: 1, unitPriceCents: 35_000, discountCents: 0 }] },
        payment: { crNumber: String(cr++), tenders: [{ cashPlaceId: till, amountCents: 35_000 }] }, expectedTotalCents: 35_000,
      }, 'quick sale');
      await record(encoder, 'exp.voucher', {
        categoryId, cashPlaceId: till, amountCents: 25_000, description: 'Perf shop supplies and utilities', supplierId: utility,
        supplierInvoiceNo: `UTIL-${day + 1}`, supplierInvoiceDate: date,
      });
      if (day % 2 === 0) {
        const bill = await record(encoder, 'ap.bill', {
          supplierId: supplier, supplierInvoiceNo: `PERF-${++billNo}`, supplierInvoiceDate: date, lines: [{ supplyId: cloth, amountCents: 112_000 }],
        });
        billsToPay.push({ id: bill.id as string, amountCents: 112_000 });
      }
      if (day % 3 === 1 && billsToPay.length) {
        const bill = billsToPay.shift()!;
        await record(encoder, 'ap.payment', {
          supplierId: supplier, bills: [{ billId: bill.id, amountCents: bill.amountCents }], tenders: [{ cashPlaceId: bank, amountCents: bill.amountCents }],
        });
      }
      // What the till holds above a working float of ₱600,000 goes to the bank once it passes ₱1,000,000, as a shop would deposit it.
      const held = cashBalance(db, till);
      if (held > 100_000_000) {
        const deposit = held - (held % 100) - 60_000_000;
        await record(encoder, 'cash.transfer', { fromCashPlaceId: till, toCashPlaceId: bank, amountSentCents: deposit, amountReceivedCents: deposit });
      }

      // Cutoffs close after the day's work: payroll on the 15th and month end, the till counted at month end.
      clock.set(new Date(START + day * DAY_MS + 7 * 3_600_000).toISOString());
      accountant = await login('accountant');
      encoder = await login('encoder');
      const dayOfMonth = Number(date.slice(8));
      const monthEnd = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
      if (dayOfMonth === 15 || dayOfMonth === monthEnd) {
        const run = await record(accountant, 'pay.run', { payGroup: 'SEMI_MONTHLY', periodStart: `${date.slice(0, 8)}${dayOfMonth === 15 ? '01' : '16'}` });
        const slips = ok(await accountant.get(`/api/pay/runs/${run.id}/payslips`), 'payroll slips');
        const people = slips.employees as { employeeId: string; netCents: number }[];
        const total = people.reduce((sum, person) => sum + person.netCents, 0);
        if (total > 0 && total <= cashBalance(db, till)) await record(accountant, 'pay.release', {
          runId: run.id, employeeIds: people.map((person) => person.employeeId), tenders: [{ cashPlaceId: till, amountCents: total }],
        });
      }
      if (dayOfMonth === monthEnd) {
        await record(encoder, 'cash.count', { cashPlaceId: till, lines: denominations(cashBalance(db, till)), note: `Month-end count ${date}` });
        opts.progress?.(`${date}: day ${day + 1} of ${days}, ${jobSerial} job orders, ${customers.length} customers`);
      }
      if (day > 0 && dayOfMonth === 1 && [1, 4, 7, 10].includes(Number(date.slice(5, 7)))) {
        await record(accountant, 'tax.vat_close', quarter(manilaDate(new Date(START + (day - 1) * DAY_MS))));
      }
    }
    const failures = runInvariants(db).filter((result) => !result.ok);
    if (failures.length) throw new Error(`Perf data failed invariants: ${JSON.stringify(failures)}`);
    const documents = Object.fromEntries((db.prepare(
      'SELECT doc_type, COUNT(*) AS n FROM documents GROUP BY doc_type ORDER BY doc_type',
    ).all() as { doc_type: string; n: number }[]).map((row) => [row.doc_type, row.n]));
    const summary: PerfSummary = {
      options: { seed, days, customers: opts.customers, jobOrders: opts.jobOrders, employees: opts.employees, start: opts.start },
      passwords, documents, customers: customers.length, employees: staff.length, fingerprint: fingerprint(db),
    };
    db.pragma('wal_checkpoint(TRUNCATE)');
    return summary;
  } finally {
    if (app) await app.close();
    db.close();
  }

  async function ok0(who: Client, url: string, body: unknown, action: string): Promise<Json> {
    return ok(await who.post(url, body, { 'idempotency-key': randomUUID() }), action);
  }
}

async function signInAs(app: FastifyInstance, role: Role, password: string): Promise<Client> {
  return client(app, await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: `perf-${role}`, password } }));
}

/** A hash of what the database says in business terms: documents, their totals and every journal line, ids left out. */
export function fingerprint(db: Db): string {
  const hash = createHash('sha256');
  for (const d of db.prepare(`SELECT doc_type, number, external_number, business_date, status, total_cents, summary FROM documents ORDER BY doc_type, number`)
    .iterate() as Iterable<Record<string, unknown>>) hash.update(JSON.stringify(Object.values(d)) + '\n');
  for (const l of db.prepare(`SELECT j.number AS journal, a.code AS account, l.debit_cents AS debit, l.credit_cents AS credit
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id ORDER BY j.number, l.id`)
    .iterate() as Iterable<Record<string, unknown>>) hash.update(JSON.stringify(Object.values(l)) + '\n');
  return hash.digest('hex');
}

const USAGE = 'Usage: npm run perf-data -- [--db data/perf/perf.db] [--seed 1] [--days 1096] [--customers 6000] [--jobs 25000] [--employees 30] [--start 2026-01-01]';

export const PERF_DB = 'data/perf/perf.db';

function args(argv: string[]): { db: string } & Partial<PerfOptions> {
  const out: { db: string } & Partial<PerfOptions> = { db: PERF_DB };
  const number = (v: string | undefined) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(USAGE); return n; };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[++i];
    if (flag === '--db') out.db = value ?? '';
    else if (flag === '--seed') out.seed = number(value);
    else if (flag === '--days') out.days = number(value);
    else if (flag === '--customers') out.customers = number(value);
    else if (flag === '--jobs') out.jobOrders = number(value);
    else if (flag === '--employees') out.employees = number(value);
    else if (flag === '--start') out.start = value;
    else throw new Error(USAGE);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { db, ...options } = args(process.argv.slice(2));
  const began = Date.now();
  createPerfData(db, { ...options, progress: (line) => console.log(`[${Math.round((Date.now() - began) / 1000)}s] ${line}`) })
    .then((summary) => {
      // The passwords are made up and fixed by the seed; the timing test reads them from here.
      writeFileSync(`${resolve(db)}.json`, `${JSON.stringify(summary, null, 2)}\n`);
      console.log('Documents:', summary.documents);
      console.log(`Customers ${summary.customers}, employees ${summary.employees}.`);
      console.log(`Fingerprint ${summary.fingerprint}`);
      console.log(`Built in ${Math.round((Date.now() - began) / 1000)} s. Invariants: clean`);
    })
    .catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
