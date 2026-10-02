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
import { SESSION_COOKIE } from '../../engine/security/sessions.ts';

export const DAY_MS = 86_400_000;
/** The made-up users' passwords are random and thrown away, so a cheap hash keeps the build quick (the cost is in each hash). */
export const PRACTICE_SCRYPT_N = 2 ** 10;
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
      await record(production, 'prd.entry', {
        jobOrderId: jo.id, stepId: 6, rows: [{ lineNo: 1, employeeId: sewer, pieces: 5 }],
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

      // Cutoffs close after the day's work. A weekly piece run is recorded on
      // Saturdays; the office run is recorded on the 15th and month end.
      clock.set(new Date(START + day * DAY_MS + 7 * 3_600_000).toISOString());
      accountant = await signIn(app, 'accountant', passwords.accountant);
      encoder = await signIn(app, 'encoder', passwords.encoder);
      const weekday = new Date(START + day * DAY_MS).getUTCDay();
      const dayOfMonth = Number(date.slice(8));
      const monthEnd = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
      const runs: { payGroup: string; periodStart: string }[] = [];
      if (weekday === 6) {
        const monday = manilaDate(new Date(START + (day - 5) * DAY_MS));
        runs.push({ payGroup: 'WEEKLY_PIECE', periodStart: monday });
      }
      if (dayOfMonth === 15 || dayOfMonth === monthEnd) {
        runs.push({ payGroup: 'SEMI_MONTHLY', periodStart: `${date.slice(0, 8)}${dayOfMonth === 15 ? '01' : '16'}` });
      }
      for (const input of runs) {
        const run = await record(accountant, 'pay.run', input);
        const slips = ok(await accountant.get(`/api/pay/runs/${run.id}/payslips`), 'payroll slips');
        const people = slips.employees as { employeeId: string; netCents: number }[];
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
