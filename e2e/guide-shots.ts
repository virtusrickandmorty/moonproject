/**
 * Screenshots for the owner guides (docs/owner-guide). Run it with `npm run guide-shots`; it is not part of `npm test`, `npm run e2e` or CI.
 *
 * It starts the server on a fresh practice shop (serve-practice.ts: 30 days of made-up data, plus the open work the
 * every-screen spec adds), signs in with the role each guide is written for, opens the screens the guide describes and
 * saves docs/owner-guide/img/<guide number>-<short name>.png, 1024 pixels wide, at most two per guide. Everything on
 * these screens is made up. Where Chromium is already installed, point E2E_CHROMIUM at it (as for `npm run e2e`).
 * GUIDE_SHOTS_ONLY=01,05 takes only those guides' pictures. While working on the script, GUIDE_SHOTS_KEEP=<folder> keeps the
 * practice shop running in the background between runs (making its history takes minutes); stop it with `pkill -f serve-practice`.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { openWork, signInApi, type Signed } from './practice-work.ts';
import { MENU_ALL_OPEN } from './menu-open.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = join(ROOT, 'docs', 'owner-guide', 'img');
const PORT = Number(process.env.GUIDE_SHOTS_PORT ?? 3197);
const BASE = `http://127.0.0.1:${PORT}`;
const WIDTH = 1024;
const HEIGHT = 700;
const keep = process.env.GUIDE_SHOTS_KEEP;
const only = (process.env.GUIDE_SHOTS_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);

type Role = 'owner' | 'accountant' | 'encoder' | 'production';
const USERNAME: Record<Role, string> = { owner: 'practice-owner', accountant: 'practice-accountant', encoder: 'practice-encoder', production: 'practice-production' };

interface Shot {
  /** The guide's number, two digits, and a short name for the file. */
  guide: string;
  name: string;
  /** The role the guide is written for. */
  role: Role;
  /** A taller picture, for a screen that needs the room (1024 wide all the same). */
  height?: number;
  /** Gets the screen the guide's step describes onto the page. */
  show: (page: Page) => Promise<void>;
}

const link = (page: Page, name: string | RegExp) => page.getByRole('link', { name, exact: typeof name === 'string' }).first();
const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' }).first();

/** Settles the open page: the data loaded, the "Loading…" gone. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main')).not.toHaveText(/^\s*Loading…\s*$/, { timeout: 15_000 });
  await page.waitForTimeout(300);
}

/** Opens a screen by its menu item. */
async function menu(page: Page, item: string) {
  await link(page, item).click();
  await settle(page);
}

/** A screen by its address, as the menu would reach it. */
const screen = (path: string) => async (page: Page) => {
  await page.goto(path);
  await settle(page);
};

/** The first link in the table (or list) that a screen shows, opened. */
async function openFirst(page: Page, path?: RegExp) {
  const rows = page.locator('main table tbody tr a, main table tbody tr td button, main ul li a');
  await (path ? rows.filter({ hasText: path }) : rows).first().click();
  await settle(page);
}

/** Brings a part of a long screen into the picture, with the heading above it in view. */
let scrolled = false;
async function scrollTo(page: Page, what: Locator, above = 80) {
  scrolled = true;
  await what.first().scrollIntoViewIfNeeded();
  await page.evaluate((y) => window.scrollBy(0, -y), above);
  await page.waitForTimeout(150);
}

/** Picks the option of a list whose words match. */
async function selectLike(select: Locator, words: RegExp) {
  const options = await select.locator('option').evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => ({ value: o.value, text: o.textContent ?? '' })));
  const found = options.find((o) => words.test(o.text));
  if (!found) throw new Error(`No choice matches ${words}`);
  await select.selectOption(found.value);
}

/** What a person would type into an empty box, guessed from its label. All of it is made up. */
function typedFor(label: string, kind: string, mode: string | null): string {
  const example = /\blike (\d{4}-(?:Q\d|\d\d)|\d{3}-\d{3}-\d{3}-\d{3})/i.exec(label)?.[1];
  if (example) return example;
  if (/^tin/i.test(label)) return '123-456-789-000';
  if (kind === 'number' || mode === 'numeric' || /pieces|quantity|qty|days|hours|how many/i.test(label)) return '2';
  if (mode === 'decimal' || /amount|price|cost|rate|fee|pay\b|₱/i.test(label)) return '100.00';
  if (/number|no\.|#|reference|booklet/i.test(label)) return '1001';
  return 'Practice entry';
}

const isSearch = (label: string) => /^search|type 2 or more|number or customer|release number|name or code/i.test(label);

/** Types into a search box until it lists something, and picks the first thing listed. */
async function pickFirst(input: Locator) {
  for (const query of ['Practice', 'JO-', 'REL-', 'PO-', '0']) {
    await input.fill(query);
    const found = input.locator('xpath=..').getByRole('button').filter({ hasNotText: /^(Change|\+|Add|✕)/ });
    await found.first().waitFor({ state: 'visible', timeout: 1_500 }).catch(() => undefined);
    if (await found.count()) return void (await found.first().click());
  }
  await input.fill('');
}

/** Fills whatever is empty on the open form the way a person would: the first choice of each list, the first thing a search finds, a made-up word or amount. */
async function fillIn(page: Page, today: string) {
  const main = page.locator('main');
  const sides: Record<string, number> = {};
  for (let pass = 0; pass < 6; pass++) {
    for (const k of Object.keys(sides)) sides[k] = 0;
    for (const select of await main.locator('select:visible').all()) {
      if ((await select.isDisabled()) || (await select.inputValue()) !== '') continue;
      const values = await select.locator('option').evaluateAll((os) => (os as HTMLOptionElement[]).filter((o) => !o.disabled && o.value !== '').map((o) => o.value));
      if (values[0] !== undefined) await select.selectOption(values[0]);
    }
    for (const group of await main.getByRole('radiogroup').all()) {
      if (await group.locator('[aria-checked=true]').count()) continue;
      const first = group.locator('[role=radio]:not([disabled])').first();
      if (await first.count()) await first.click({ timeout: 3_000 }).catch(() => undefined);
    }
    for (const input of await main.locator('input:visible, textarea:visible').all()) {
      if (!(await input.isVisible().catch(() => false))) continue;
      const info = await input.evaluate((el) => {
        const e = el as HTMLInputElement;
        return { type: e.type, value: e.value, mode: e.inputMode || null, label: (e.labels?.[0]?.textContent ?? e.getAttribute('aria-label') ?? '').trim(), hint: e.placeholder, off: e.disabled || e.readOnly };
      });
      if (info.off || ['checkbox', 'radio', 'file', 'hidden', 'password', 'button', 'search'].includes(info.type)) continue;
      let wrongSide = false;
      if (info.hint === 'Debit' || info.hint === 'Credit') {
        const seen = (sides[info.hint] = (sides[info.hint] ?? 0) + 1);
        wrongSide = info.hint === 'Debit' ? seen !== 1 : seen !== 2;
      }
      if (wrongSide || info.value !== '' || /owed to the supplier|financed by a lender/i.test(info.label)) continue;
      if (/^[1-9]\d*\.\d\d$/.test(info.hint)) continue;
      if (isSearch(info.hint) || isSearch(info.label)) {
        await pickFirst(input);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        break;
      } else await input.fill(info.type === 'date' ? today : typedFor(info.label || info.hint, info.type, info.mode));
    }
  }
  await page.waitForTimeout(600);
}

/** A "+ New" form of a document type, filled in the way a person would (nothing is recorded). */
const form = (key: string, then?: (page: Page) => Promise<void>) => async (page: Page) => {
  await page.goto(`/docs/${key}/new`);
  await settle(page);
  await fillIn(page, await page.evaluate(() => fetch('/api/health').then((r) => r.json() as Promise<{ serverTime: string }>)).then((h) => h.serverTime.slice(0, 10)));
  await then?.(page);
};

/** The form's Record button pressed, so the box that asks "Record this …?" is in the picture (nothing is recorded until the second Record). */
async function preview(page: Page) {
  await page.locator('main').getByRole('button', { name: /^(Record|Write off|Forfeit)$/ }).first().click();
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 8_000 });
  await page.waitForTimeout(300);
}

/** Previews a document, then records it with the total the preview gave, as the Record button does. */
async function record(who: Signed, type: string, input: object): Promise<Record<string, any>> {
  const preview = await who.post(`/api/docs/${type}/preview`, { input });
  return who.post(`/api/docs/${type}/post`, { input, expectedTotalCents: preview.totalCents }, { 'idempotency-key': randomUUID() });
}

/** One more job order beyond what the every-screen spec makes: paid in full and finished in the workroom, so its release form has nothing to warn about. */
async function readyForRelease(owner: Signed, production: Signed) {
  const till = ((await owner.get('/api/cash/places')) as unknown as { id: number; name: string }[]).find((c) => c.name === 'Practice counter till')!.id;
  const customer = ((await owner.get('/api/cus/customers?q=Practice')) as unknown as { id: string }[])[0]!.id;
  const sewer = ((await owner.get('/api/emp/employees')) as unknown as { id: string; costCentre: string }[]).find((e) => e.costCentre === 'production')!.id;
  const jo = await record(owner, 'jo.job_order', {
    customerId: customer, dueInDays: 5, priority: 'normal', paymentTerms: 'full',
    lines: [{ kind: 'made_to_order', description: 'Polo shirts', qty: 12, unitPriceCents: 45_000, discountCents: 0, roster: [] }],
  });
  await record(owner, 'col.collection', { customerId: customer, crNumber: '880010', applications: [{ jobOrderId: jo.id, amountCents: 540_000 }], tenders: [{ cashPlaceId: till, amountCents: 540_000 }] });
  await production.post(`/api/prd/jobs/${jo.id}/lines/1/setup`, { templateId: 1, stepIds: [6, 8], garmentType: 'T-shirt', complexity: 'standard' });
  await record(production, 'prd.entry', { jobOrderId: jo.id, stepId: 6, rows: [{ lineNo: 1, employeeId: sewer, pieces: 12 }] });
  for (const step of [6, 8]) await production.post(`/api/prd/jobs/${jo.id}/lines/1/steps/${step}/complete`, {});
}

let workDir = '';
const known: Record<string, string> = {};

/** The owner turns backups on the way 05-backups does (recovery keys, then the first backup), so the restore screen has a backup to list. */
async function setUpBackups(page: Page) {
  await page.goto('/bak');
  await link(page, 'Recovery keys and folders').click();
  await page.getByLabel('Backup folder').fill(join(workDir, 'practice', 'backups'));
  await page.getByLabel('Off-site folder').fill(join(workDir, 'practice', 'offsite'));
  await button(page, 'Make new recovery keys').click();
  const keyA = await page.getByRole('heading', { name: 'Recovery key A' }).locator('xpath=following-sibling::p[1]').innerText();
  const keyB = await page.getByRole('heading', { name: 'Recovery key B' }).locator('xpath=following-sibling::p[1]').innerText();
  await page.getByLabel(/^Last \d+ characters of key A/).fill(keyA.slice(-8));
  await page.getByLabel(/^Last \d+ characters of key B/).fill(keyB.slice(-8));
  await button(page, 'Save the folders and the new keys').click();
  await page.getByLabel('Enter your password again to continue').fill(known.owner!);
  await button(page, 'Continue').click();
  await expect(page.getByText('Saved. New backups are locked with the new recovery keys.')).toBeVisible();
  await link(page, 'Status').click();
  await button(page, 'Back up now').click();
  await expect(page.getByText(/^Backed up: /)).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------------
// The pictures. Each shows the screen a step of the guide is about, with the role the guide is written for.
// ---------------------------------------------------------------------------------------------------------------------
const SHOTS: Shot[] = [
  // 1: a customer, wearers, measurements
  { guide: '01', name: 'customers', role: 'encoder', show: screen('/cus') },
  { guide: '01', name: 'wearers', role: 'encoder', show: async (p) => { await p.goto('/cus'); await settle(p); await openFirst(p); await scrollTo(p, p.getByRole('heading', { name: /Wearers/ })); } },
  // 2 to 5: the sales desk
  { guide: '02', name: 'new-job-order', role: 'encoder', show: async (p) => {
    await p.goto('/docs/jo.job_order/new'); await settle(p);
    await pickFirst(p.getByRole('textbox', { name: 'Customer', exact: true }));
    await p.getByLabel('Line 1 description').fill('Polo shirts');
    await p.getByLabel('Line 1 pieces').fill('12');
    await p.getByLabel('Line 1 price each').fill('450.00');
    await p.getByLabel('Payment terms *').selectOption({ label: '50% downpayment' });
    await p.waitForTimeout(600);
  } },
  { guide: '03', name: 'job-order', role: 'encoder', show: async (p) => { await p.goto('/docs/jo.job_order'); await settle(p); await openFirst(p, /JO-/); } },
  { guide: '03', name: 'new-release', role: 'encoder', show: async (p) => {
    await p.goto('/docs/jo.release/new'); await settle(p);
    await p.getByRole('button', { name: /12 pieces left/ }).click();
    await p.getByLabel('Claimed by *').fill('Practice Collector');
    await p.getByRole('radio', { name: 'Government ID' }).click();
    await p.getByLabel(/^Invoice number/).fill('880201');
    await p.waitForTimeout(600);
  } },
  { guide: '04', name: 'new-collection', role: 'encoder', show: async (p) => {
    await p.goto('/docs/col.collection/new'); await settle(p);
    await pickFirst(p.getByRole('textbox', { name: 'Customer', exact: true }));
    await p.getByLabel(/^CR number/).fill('880020');
    await p.getByRole('radio', { name: /^Cash on hand/ }).click();
    await p.getByLabel('Amount', { exact: true }).first().fill('1500.00');
    await p.waitForTimeout(600);
  } },
  { guide: '05', name: 'new-quick-sale', role: 'encoder', show: async (p) => {
    await p.goto('/docs/qs.sale/new'); await settle(p);
    await p.getByLabel('What', { exact: true }).fill('Shorten sleeves');
    await p.getByLabel('Price each').fill('150.00');
    await p.getByLabel(/^Invoice number/).fill('880301');
    await p.getByRole('radio', { name: /^Cash on hand/ }).click();
    await p.getByLabel(/^CR number/).fill('880302');
    await p.waitForTimeout(600);
  } },
  // 6: payroll
  { guide: '06', name: 'payroll-run', role: 'accountant', show: form('pay.run') },
  { guide: '06', name: 'payroll-release', role: 'accountant', show: async (p) => {
    await p.goto('/docs/pay.release/new'); await settle(p);
    await p.getByRole('radio', { name: /^PAY-/ }).first().click();
    await p.getByRole('radio', { name: /^Cash on hand/ }).click();
    await p.getByLabel('Amount').first().fill('6600.00');
    await p.waitForTimeout(600);
  } },
  // 7, 8: cash
  { guide: '07', name: 'cash-accounts', role: 'accountant', show: screen('/cash/accounts') },
  { guide: '07', name: 'new-cash-count', role: 'accountant', show: async (p) => {
    await p.goto('/docs/cash.count/new'); await settle(p);
    await p.getByLabel('Cash box *').selectOption({ label: 'Practice counter till (1104)' }).catch(() => p.getByLabel('Cash box *').selectOption({ index: 3 }));
    for (const [d, n] of [['₱1,000.00', '60'], ['₱500.00', '10'], ['₱100.00', '45'], ['₱50.00', '12'], ['₱20.00', '30'], ['₱5.00', '40'], ['₱1.00', '30']]) await p.getByLabel(`${d} quantity`).fill(n!);
    await p.waitForTimeout(600);
  } },
  { guide: '08', name: 'cash-book', role: 'accountant', show: async (p) => {
    await p.goto('/cash/book'); await settle(p);
    await p.getByLabel('Cash place').selectOption({ label: 'Practice counter till' }).catch(() => p.getByLabel('Cash place').selectOption({ index: 3 }));
    await p.getByLabel('From').fill('2026-09-04');
    await button(p, 'Show cash book').click(); await settle(p);
  } },
  { guide: '09', name: 'trial-balance', role: 'accountant', show: async (p) => { await p.goto('/rpt/trial-balance'); await settle(p); await button(p, 'Show').click(); await settle(p); } },
  // 11, 12: backups
  { guide: '11', name: 'recovery-keys', role: 'owner', show: async (p) => {
    await p.goto('/bak'); await link(p, 'Recovery keys and folders').click(); await settle(p);
    await p.getByLabel('Backup folder').fill('D:\\Moonproject-Backups');
  } },
  // 13: bills and expenses
  { guide: '13', name: 'new-supplier-bill', role: 'encoder', show: form('ap.bill') },
  { guide: '13', name: 'record-expense-voucher', role: 'encoder', show: form('exp.voucher', preview) },
  { guide: '15', name: 'new-inventory-count', role: 'encoder', show: form('inv.count') },
  { guide: '16', name: 'income-statement', role: 'accountant', show: screen('/rpt/income-statement') },
  { guide: '16', name: 'balance-sheet', role: 'accountant', show: screen('/rpt/balance-sheet') },
  { guide: '17', name: 'opening-balances', role: 'owner', show: screen('/acc/opening') },
  { guide: '18', name: 'tax-calendar', role: 'accountant', show: screen('/tax/calendar') },
  { guide: '18', name: 'vat-worksheet', role: 'accountant', show: screen('/tax/2550q') },
  { guide: '19', name: 'calendar', role: 'encoder', show: screen('/cal') },
  { guide: '19', name: 'audit-log', role: 'owner', show: screen('/aud/log') },
  { guide: '21', name: 'remittances', role: 'accountant', show: screen('/stat') },
  { guide: '22', name: 'cash-advance-employee', role: 'accountant', show: async (p) => { await p.goto('/ca/employees'); await settle(p); await openFirst(p); } },
  { guide: '23', name: 'thirteenth-month', role: 'accountant', show: async (p) => { await p.goto('/docs/pay.thirteenth/new'); await settle(p); } },
  { guide: '24', name: 'government-loans', role: 'accountant', show: screen('/pay/loans') },
  { guide: '25', name: 'system-health', role: 'owner', show: screen('/admin/health') },
  { guide: '26', name: 'collections-register', role: 'accountant', show: screen('/rpt/collections-register') },
  { guide: '27', name: 'new-2307-received', role: 'accountant', show: async (p) => {
    await p.goto('/docs/col.cwt_only/new'); await settle(p);
    await pickFirst(p.getByPlaceholder(/^Type 2 or more letters/));
  } },
  { guide: '27', name: 'new-deposit-forfeit', role: 'accountant', show: async (p) => { await p.goto('/docs/col.forfeit/new'); await settle(p); await pickFirst(p.getByRole('textbox', { name: /Customer/ }).first()); } },
  { guide: '28', name: '2316-and-alphalist', role: 'accountant', show: screen('/pay/2316') },
  { guide: '29', name: 'sales-register', role: 'accountant', show: screen('/tax/sales') },
  { guide: '29', name: '2307s-received', role: 'accountant', show: screen('/tax/2307-received') },
  { guide: '30', name: 'suppliers', role: 'encoder', show: screen('/pur/suppliers') },
  { guide: '30', name: 'new-purchase-order', role: 'encoder', show: form('pur.po') },
  { guide: '31', name: 'import-old-data', role: 'owner', show: screen('/mig') },
  { guide: '32', name: 'bank-reconciliation', role: 'accountant', show: async (p) => {
    await p.goto('/cash/recon'); await settle(p);
    await p.getByLabel(/^Bank account/).selectOption({ label: 'Practice bank' }).catch(() => p.getByLabel(/^Bank account/).selectOption({ index: 1 }));
    await p.getByLabel(/^Statement ending balance/).fill('75000.00');
  } },
  { guide: '33', name: 'month-end-checklist', role: 'accountant', show: screen('/acc/month-end') },
  { guide: '34', name: 'agency-files', role: 'accountant', show: async (p) => { await p.goto('/stat'); await settle(p); await link(p, /^Lists and 1601-C worksheet for/).click(); await settle(p); await scrollTo(p, p.getByRole('heading', { name: /^Files for the agencies/ })); } },
  { guide: '34', name: 'exposure', role: 'accountant', show: screen('/stat/exposure') },
  { guide: '35', name: 'users', role: 'owner', show: screen('/admin/users') },
  { guide: '35', name: 'add-a-user', role: 'owner', show: async (p) => { await p.goto('/admin/users'); await settle(p); await button(p, 'Add a user').click(); await settle(p); } },
  { guide: '36', name: 'fixed-assets', role: 'accountant', show: screen('/fa/assets') },
  { guide: '36', name: 'owners-and-officers', role: 'accountant', show: screen('/eq/people') },
  { guide: '37', name: 'job-order-downpayment', role: 'encoder', show: async (p) => { await p.goto('/docs/jo.job_order'); await settle(p); await openFirst(p, /JO-000032/); } },
  { guide: '37', name: 'job-orders', role: 'encoder', show: screen('/docs/jo.job_order') },
  { guide: '38', name: 'ap-aging', role: 'accountant', show: screen('/rpt/ap-aging') },
  { guide: '38', name: 'bir-books', role: 'accountant', show: screen('/rpt/bir-books') },
  { guide: '40', name: 'price-list', role: 'encoder', show: screen('/cat') },
  { guide: '40', name: 'new-quotation', role: 'encoder', show: form('quo.quotation') },
  { guide: '41', name: 'production-board', role: 'production', show: screen('/prd/board') },
  { guide: '41', name: 'record-pieces', role: 'production', show: async (p) => { await p.goto('/prd/board'); await settle(p); await link(p, '+ Record pieces').click(); await settle(p); await selectLike(p.getByRole('combobox').first(), /JO-000031/);  await p.locator('main').getByText('Sewing', { exact: true }).click(); await p.waitForTimeout(500); } },
  { guide: '42', name: 'employees', role: 'accountant', show: screen('/emp/employees') },
  { guide: '42', name: 'employee', role: 'accountant', show: async (p) => { await p.goto('/emp/employees'); await settle(p); await openFirst(p); } },
  { guide: '43', name: 'search', role: 'owner', show: async (p) => { await p.goto('/'); await settle(p); await p.getByPlaceholder(/^Search customers/).fill('Practice'); await p.waitForTimeout(1200); } },
  { guide: '43', name: 'tv-board', role: 'production', show: screen('/prd/tv') },
  { guide: '44', name: 'company-print-details', role: 'owner', show: screen('/prt/company-profile') },
  { guide: '44', name: 'printer-test-pack', role: 'owner', show: screen('/prt/test-pack') },
  { guide: '45', name: 'sizer-sets', role: 'production', show: screen('/szr/sets') },
  { guide: '46', name: 'dispose-of-an-asset', role: 'accountant', show: async (p) => { await p.goto('/fa/assets'); await settle(p); await openFirst(p); await button(p, 'Dispose of this asset').click(); await p.getByRole('dialog').waitFor(); await p.getByRole('dialog').getByRole('radio', { name: 'Sold', exact: true }).click(); await p.waitForTimeout(500); } },
  { guide: '47', name: 'email-settings', role: 'owner', show: screen('/com/settings') },
  { guide: '47', name: 'email-outbox', role: 'owner', show: screen('/com') },
  { guide: '48', name: 'go-live-decisions', role: 'accountant', show: screen('/acc/go-live-decisions') },
  { guide: '49', name: 'cash-flow-statement', role: 'accountant', show: screen('/rpt/cash-flow') },
  { guide: '50', name: 'customer-statement', role: 'accountant', show: async (p) => {
    await p.goto('/rpt/customer-statement'); await settle(p);
    await p.getByLabel('Customer').selectOption({ index: 1 });
    await button(p, 'Show').click(); await settle(p);
  } },
  { guide: '51', name: 'run-depreciation', role: 'accountant', show: async (p) => { await p.goto('/fa/assets'); await settle(p); await button(p, 'Run depreciation').click(); await p.getByRole('dialog').waitFor(); } },
  { guide: '52', name: 'leave-balances', role: 'accountant', show: screen('/emp/leave-balances') },
  { guide: '53', name: '2307s-to-issue', role: 'accountant', show: screen('/tax/2307-to-issue') },
  { guide: '54', name: 'income-statement-compared', role: 'accountant', show: async (p) => {
    await p.goto('/rpt/income-statement'); await settle(p);
    await button(p, 'This month').click(); await settle(p);
    await p.getByLabel('Compare with').selectOption({ label: 'Previous month' });
    await button(p, 'Show').click(); await settle(p);
  } },
  { guide: '55', name: 'new-post-dated-check', role: 'encoder', show: async (p) => { await p.goto('/col/pdcs'); await settle(p); await button(p, '+ Add a post-dated check').click(); await settle(p); } },
  { guide: '56', name: 'nightly-checks', role: 'owner', show: screen('/aud/nightly') },
  { guide: '57', name: 'expense-voucher-split', role: 'encoder', show: form('exp.voucher', async (p) => { await button(p, '+ Split the payment').click(); await p.waitForTimeout(400); await scrollTo(p, p.getByRole('heading', { name: 'Where did the money come from?' }), 20); }) },
  { guide: '58', name: 'attachments', role: 'encoder', show: async (p) => { await p.goto('/docs/col.collection'); await settle(p); await openFirst(p, /COL-/); await scrollTo(p, p.getByRole('heading', { name: 'Attachments' })); } },
  { guide: '59', name: 'new-journal-voucher', role: 'accountant', show: form('acc.jv', async (p) => { await p.getByRole('checkbox', { name: /Reverse on the first day of next month/ }).check(); await p.waitForTimeout(400); }) },
  { guide: '60', name: 'new-dividend', role: 'accountant', show: screen('/docs/eq.dividend/new') },
  { guide: '61', name: 'bad-debts-setting', role: 'accountant', show: async (p) => { await p.goto('/acc/settings'); await settle(p); await scrollTo(p, p.getByText('Bad debts').first()); } },
  { guide: '62', name: 'new-uncollected-vat', role: 'accountant', show: screen('/docs/tax.uncollected_vat/new') },
  { guide: '63', name: 'home-charts', role: 'owner', height: 1100, show: async (p) => { await p.goto('/'); await settle(p); await scrollTo(p, p.getByRole('heading', { name: 'Last 12 months' }), 20); } },
  // Last: it turns backups on, which every screen after it would show (and the audit log would list the keys' public halves).
  { guide: '12', name: 'restore-and-drill', role: 'owner', show: async (p) => { await setUpBackups(p); await p.goto('/bak'); await link(p, 'Restore and drill').click(); await settle(p); } },
];

// ---------------------------------------------------------------------------------------------------------------------
// The machinery.
// ---------------------------------------------------------------------------------------------------------------------
async function startShop(dir: string): Promise<ChildProcess> {
  // Its own process group, so stopping it stops the server tsx starts as well.
  const server = spawn(join(ROOT, 'node_modules', '.bin', 'tsx'), ['e2e/serve-practice.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), E2E_DIR: dir }, stdio: ['ignore', 'ignore', 'inherit'], detached: true });
  const deadline = Date.now() + 240_000; // making 30 days of made-up data comes first
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('The practice shop did not start.');
    if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) return server;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The practice shop took too long to start.');
}

async function signInAs(browser: Browser, role: Role, passwords: Record<string, string>): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, baseURL: BASE });
  // Every menu group open, as in the screenshots so far and so that menu items are clicked by name wherever they are.
  await context.addInitScript(({ name, value }) => localStorage.setItem(name, value), MENU_ALL_OPEN);
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Username').fill(USERNAME[role]);
  await page.getByLabel('Password').fill(passwords[role]!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /▾/ })).toBeVisible();
  await settle(page);
  return page;
}

/** Squeezes a PNG: 128 colours is plenty for these flat screens. ImageMagick does it when it is installed. */
function compress(file: string) {
  try {
    execFileSync('convert', [file, '-colors', '128', '-strip', '-define', 'png:compression-level=9', file]);
  } catch {
    // Without ImageMagick the picture is kept as Playwright saved it.
  }
}

async function main() {
  const chosen = SHOTS.filter((s) => !only.length || only.includes(s.guide));
  const perGuide = new Map<string, number>();
  for (const s of SHOTS) perGuide.set(s.guide, (perGuide.get(s.guide) ?? 0) + 1);
  for (const [guide, n] of perGuide) if (n > 2) throw new Error(`Guide ${guide} has ${n} pictures; two at most.`);

  const dir = keep ?? mkdtempSync(join(tmpdir(), 'moonproject-guide-shots-'));
  const running = Boolean(keep) && (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false));
  const executablePath = process.env.E2E_CHROMIUM || undefined;
  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    if (!running) {
      server = await startShop(dir);
      if (keep) server.unref();
    }
    const passwords = JSON.parse(readFileSync(join(dir, 'practice-passwords.json'), 'utf8')) as Record<string, string>;
    workDir = dir;
    Object.assign(known, passwords);
    if (!running) {
      const [owner, production, accountant] = await Promise.all((['owner', 'production', 'accountant'] as const).map((r) => signInApi(BASE, USERNAME[r], passwords[r]!)));
      try {
        await openWork(owner!, production!, accountant!);
        await readyForRelease(owner!, production!);
      } finally {
        await Promise.all([owner, production, accountant].map((s) => s!.close()));
      }
    }

    browser = await chromium.launch({ executablePath });
    mkdirSync(IMG, { recursive: true });
    const pages = new Map<Role, Page>();
    const failed: string[] = [];
    for (const shot of chosen) {
      let page = pages.get(shot.role);
      if (!page) pages.set(shot.role, (page = await signInAs(browser, shot.role, passwords)));
      const file = join(IMG, `${shot.guide}-${shot.name}.png`);
      try {
        scrolled = false;
        await page.setViewportSize({ width: WIDTH, height: shot.height ?? HEIGHT });
        await page.goto('/');
        await settle(page);
        await shot.show(page);
        await settle(page);
        if (!scrolled) await page.evaluate(() => window.scrollTo(0, 0));
      } catch (e) {
        failed.push(`${shot.guide}-${shot.name}: ${(e as Error).message.split('\n')[0]}`);
        continue;
      }
      await page.screenshot({ path: file });
      compress(file);
      console.log(`${shot.guide}-${shot.name}.png (${shot.role}, ${Math.round(statSync(file).size / 1024)} KB)`);
    }
    if (failed.length) throw new Error(`These pictures could not be taken:\n${failed.join('\n')}`);
  } finally {
    await browser?.close();
    if (!keep) {
      if (server?.pid) process.kill(-server.pid);
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const total = readdirSync(IMG).reduce((sum, f) => sum + statSync(join(IMG, f)).size, 0);
  console.log(`${readdirSync(IMG).length} pictures, ${(total / 1024 / 1024).toFixed(1)} MB in docs/owner-guide/img`);
}

if (!existsSync(join(ROOT, 'apps', 'web', 'dist', 'index.html'))) throw new Error('Build the web app first: npm run guide-shots does it.');
await main();
