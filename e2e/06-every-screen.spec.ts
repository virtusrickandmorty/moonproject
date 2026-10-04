/**
 * Every screen opens for every role, on the practice shop's made-up data (serve-practice.ts). Each default role signs in
 * and opens every menu item it sees: the page loads, says something, shows no error message, logs no console error
 * and no request is answered 403, 404 or 500. Then each "+ New" form the role is offered opens without an id to type and
 * reaches its preview. A role sees no menu item for a screen whose data it may not read.
 * The roles tour side by side, after 06-every-screen.setup.ts has put open work in, added the TV user and turned backups on.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SCREENS } from '../apps/web/src/shell/menu';
import { ROLES, practicePasswords, signInAs } from './practice-users';

/** Everything the browser reports while a page is open. */
function watch(page: Page) {
  const seen = { console: [] as string[], bad: [] as string[] };
  page.on('console', (m) => m.type() === 'error' && seen.console.push(m.text()));
  page.on('pageerror', (e) => seen.console.push(`page error: ${e.message}`));
  page.on('response', (r) => {
    const s = r.status();
    if (s === 403 || s === 404 || s >= 500) seen.bad.push(`${s} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  return {
    /** What went wrong since the last call, as plain lines. */
    take() {
      const lines = [...seen.console.map((c) => `console error: ${c}`), ...seen.bad.map((b) => `request answered ${b}`)];
      seen.console.length = seen.bad.length = 0;
      return lines;
    },
  };
}

/** What is wrong with the screen that is open now: nothing is the empty list. */
async function trouble(page: Page): Promise<string[]> {
  await page.waitForLoadState('networkidle');
  const main = page.locator('main');
  await expect.poll(async () => ((await main.innerText()).trim() === 'Loading…' ? 'loading' : 'settled'), { timeout: 15_000 }).toBe('settled').catch(() => undefined);
  const problems: string[] = [];
  const text = (await main.innerText()).trim();
  if (!text) problems.push('blank page');
  if (text === 'Loading…') problems.push('still "Loading…"');
  for (const alert of await main.getByRole('alert').allInnerTexts()) problems.push(`error message: ${alert.replace(/\s+/g, ' ').trim()}`);
  return [...problems, ...(await noHand(page))];
}

/** Every button, choice box, tick box and fold-out on the page shows the hand under the mouse, the menu's too. */
async function noHand(page: Page): Promise<string[]> {
  const missed = await page.locator('button:not(:disabled), select:not(:disabled), summary, input:is([type=checkbox], [type=radio], [type=file]):not(:disabled)').evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null && getComputedStyle(e).cursor !== 'pointer')
      .map((e) => `${e.tagName.toLowerCase()} "${(e.textContent || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`));
  return [...new Set(missed)].map((m) => `no hand cursor on ${m}`);
}

async function menuLinks(page: Page): Promise<{ label: string; href: string }[]> {
  return page.locator('nav a').evaluateAll((as) => as.map((a) => ({ label: (a.textContent ?? '').trim(), href: a.getAttribute('href') ?? '' })));
}

async function newForms(page: Page): Promise<{ label: string; href: string }[]> {
  const button = page.getByRole('button', { name: '+ New', exact: true });
  if (!(await button.count())) return [];
  await button.click();
  const links = await page.locator('header a').evaluateAll((as) => as.map((a) => ({ label: (a.textContent ?? '').trim(), href: a.getAttribute('href') ?? '' })));
  return links.filter((l) => l.href.endsWith('/new'));
}

/** What a person would type into an empty box, guessed from its label; nothing here is an id, which is the point. */
function typedFor(label: string, kind: string, mode: string | null): string {
  const example = /\blike (\d{4}-(?:Q\d|\d\d)|\d{3}-\d{3}-\d{3}-\d{3})/i.exec(label)?.[1]; // "the payroll month, like 2026-09"
  if (example) return example;
  if (/^tin/i.test(label)) return '123-456-789-000';
  if (kind === 'number' || mode === 'numeric' || /pieces|quantity|qty|days|hours|how many/i.test(label)) return '2';
  if (mode === 'decimal' || /amount|price|cost|rate|fee|pay\b|₱/i.test(label)) return '100.00';
  if (/number|no\.|#|reference|booklet/i.test(label)) return '1001';
  return 'Practice entry from the every-screen tour';
}

/** A box that finds a customer, job order, release or supply as you type, and lists what it found as buttons under itself. */
const isSearch = (label: string) => /^search|type 2 or more|number or customer|release number|name or code/i.test(label);

/** Types into a search box until it lists something, and picks the first thing listed (under the box, or under its label). */
async function pickFirst(input: Locator) {
  for (const query of ['Practice', 'JO-', 'REL-', 'PO-', '0']) {
    await input.fill(query);
    const found = input.locator('xpath=ancestor::*[not(self::label)][1]').getByRole('button').filter({ hasNotText: /^(Change|\+|Add|✕)/ });
    await found.first().waitFor({ state: 'visible', timeout: 1_500 }).catch(() => undefined);
    if (await found.count()) return void (await found.first().click());
  }
  await input.fill('');
}

/**
 * Fills whatever is empty on the open form the way a person would (the first choice of each list, the first thing a
 * search box finds, the first of each set of buttons, a made-up word or amount in each box) and returns the labels of
 * any box that asks for an id.
 */
async function fillIn(page: Page, today: string): Promise<string[]> {
  const main = page.locator('main');
  const asksForId: string[] = [];
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
      if (!(await input.isVisible().catch(() => false))) continue; // a pick just replaced this box
      const info = await input.evaluate((el) => {
        const e = el as HTMLInputElement;
        return { type: e.type, value: e.value, mode: e.inputMode || null, label: (e.labels?.[0]?.textContent ?? e.getAttribute('aria-label') ?? '').trim(), hint: e.placeholder, off: e.disabled || e.readOnly };
      });
      if (info.off || ['checkbox', 'radio', 'file', 'hidden', 'password', 'button', 'search'].includes(info.type)) continue;
      if (/(^|\s)(id|uuid)(\s|$)|\bid\b\)?$/i.test(info.label) || /^[0-9a-f]{8}-/.test(info.value)) asksForId.push(info.label);
      let wrongSide = false;
      if (info.hint === 'Debit' || info.hint === 'Credit') { // a journal line has one or the other: the first line a debit, the second a credit
        const seen = (sides[info.hint] = (sides[info.hint] ?? 0) + 1);
        wrongSide = info.hint === 'Debit' ? seen !== 1 : seen !== 2;
      }
      if (wrongSide || info.value !== '' || /owed to the supplier|financed by a lender/i.test(info.label)) continue; // optional shares of a payment stay empty
      if (/^[1-9]\d*\.\d\d$/.test(info.hint)) continue; // the amount the server suggests: changing it would ask for a reason
      if (isSearch(info.hint) || isSearch(info.label)) {
        // A pick loads what was picked and redraws the form (a release's lines appear above "Claimed by"), so the boxes
        // listed before it are stale: start the next pass on the redrawn form rather than typing into a moved box.
        await pickFirst(input);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        break;
      } else await input.fill(info.type === 'date' ? today : typedFor(info.label || info.hint, info.type, info.mode));
    }
  }
  return asksForId;
}

/** The form's own Record button (Write off and Forfeit are its names on two forms), pressed; the preview dialog it opens, if any. */
async function openPreview(page: Page) {
  const open = page.getByRole('dialog');
  if (await open.count()) return { refused: false as const, dialog: open }; // a form that is its own preview dialog (depreciation)
  const button = page.locator('main').getByRole('button', { name: /^(Record|Write off|Forfeit)$/ }).first();
  if (await button.isDisabled()) return { refused: true as const, dialog: page.getByRole('dialog') };
  await button.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
  return { refused: false as const, dialog };
}

/** What a form says, in words, when the books give it nothing to do yet: a refusal that names the reason, not a screen that failed. */
// "is already closed by": a quarter the practice data closed on the 1st of the next month (VATC-), which the VAT close form opens on.
const STATE_OF_THE_BOOKS = /cut-over date|has no VAT to close|no income tax|nothing to (adjust|provide|settle|close)|no credits to settle|is already closed by/;

/** Opens one New form, fills it in and presses Record: what is wrong with it, nothing being the empty list. */
async function checkNewForm(page: Page, href: string, today: string, take: () => string[]): Promise<string[]> {
  await page.goto(href);
  const opened = [...(await trouble(page)).filter((p) => !STATE_OF_THE_BOOKS.test(p)), ...take()];
  if (opened.length) return opened;
  const problems = (await fillIn(page, today)).map((label) => `asks for an id: "${label}"`);
  await page.waitForTimeout(600); // the live totals
  let { refused, dialog } = await openPreview(page);
  if (!refused && !(await dialog.count()) && /tick/i.test(await page.locator('main').innerText())) {
    for (const box of await page.locator('main input[type=checkbox]:visible').all()) if ((await box.isEnabled()) && !(await box.isChecked())) await box.check(); // who is paid, which bills
    await page.waitForTimeout(400);
    ({ refused, dialog } = await openPreview(page));
  }
  if (refused) {
    // A form may refuse for a reason of the shop's books (a downpayment invoice outside VAT mode C); it must then say so in words.
    const why = await page.locator('main').getByRole('alert').or(page.locator('main').getByRole('status')).allInnerTexts();
    return why.length ? problems : [...problems, 'Record is switched off and nothing says why'];
  }
  if (!(await dialog.count())) {
    const said = (await page.locator('main').locator('.text-red-700, .text-red-800, [role=alert]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    if (said.some((t) => /cut-over date/.test(t))) return problems; // an opening form says the cut-over date comes first
    return [...problems, `no preview${said.length ? `: ${said.join(' | ')}` : ''}`];
  }
  // The preview is there. What it says about the made-up figures typed in (a payment that does not match its bills) is the server's rule, not the screen's.
  return [...problems, ...take()];
}

for (const who of ROLES) {
  test(`${who.role}: every menu item opens, every New form reaches its preview`, async ({ page }) => {
    test.setTimeout(600_000);
    const seen = watch(page);
    await signInAs(page, who, practicePasswords()[who.role]!);
    seen.take(); // the 401 the sign-in page gets before anyone has signed in is not a screen's fault
    const report: string[] = [];
    const note = (where: string, lines: string[]) => lines.forEach((l) => report.push(`${where}: ${l}`));

    const links = await menuLinks(page);
    // A role sees no menu item for a screen it has no permission for: each one it sees is checked against what the server says it may do.
    const me = await page.evaluate(() => fetch('/api/auth/me').then((r) => r.json() as Promise<{ permissions: string[] }>));
    for (const item of SCREENS) {
      const shown = links.some((l) => l.href === item.path);
      if (shown && item.permission && !me.permissions.includes(item.permission)) note(`${item.label} (${item.path})`, [`shown, but ${who.role} lacks ${item.permission}`]);
    }

    console.log(`${who.role} sees ${links.length} menu items`);
    for (const link of links) {
      if (!(await page.locator('nav').count())) await page.goto('/'); // the TV board fills the screen without the menu
      await page.locator(`nav a[href="${link.href}"]`).click();
      note(`${link.label} (${link.href})`, [...(await trouble(page)), ...seen.take()]);
    }

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
    const forms = await newForms(page);
    console.log(`${who.role} is offered ${forms.length} New forms`);
    const today = (await (await page.request.get('/api/health')).json() as { serverTime: string }).serverTime.slice(0, 10);
    for (const form of forms) {
      const where = `New ${form.label} (${form.href})`;
      note(where, await checkNewForm(page, form.href, today, seen.take).catch((e: Error) => [`the test could not go on: ${e.message.split('\n')[0]}`]));
    }
    console.log(report.join('\n'));
    expect(report).toEqual([]);
  });
}
