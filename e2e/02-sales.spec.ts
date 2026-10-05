import { expect, test, type Page } from '@playwright/test';
import { OWNER, serverDate, signIn } from './shop';

const CUSTOMER = 'Harbor Rowing Club';
/** A 1×1 PNG: the design picture attached to the job order. */
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** The "So far" / money figures: the amount shown beside a label. */
const figure = (page: Page, label: string) => page.locator('dt', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::dd[1]');

async function openJobOrder(page: Page, jo = 'JO-000001') {
  await page.getByRole('link', { name: 'Job Orders', exact: true }).click();
  await page.getByRole('link', { name: jo, exact: true }).click();
  await expect(page.getByRole('heading', { name: `Job Order ${jo}` })).toBeVisible();
}

async function collect(page: Page, button: string, amount: string, cr: string, jo = 'JO-000001') {
  await page.getByRole('link', { name: button }).click();
  await fillCollection(page, amount, cr, jo);
}

/** The collection form, already open for the job order: the amount it starts with, the GCash place, the CR number. */
async function fillCollection(page: Page, amount: string, cr: string, jo = 'JO-000001') {
  await expect(page.getByRole('heading', { name: 'New collection' })).toBeVisible();
  await expect(page.getByText(CUSTOMER, { exact: true })).toBeVisible();
  await expect(page.getByLabel(new RegExp(`^Pay now on ${jo}`))).toHaveValue(amount);
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue(amount);
  await page.getByRole('radio', { name: /GCash/ }).click();
  await page.getByLabel('CR number (from the booklet)').fill(cr);
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/^Recorded as COL-/)).toBeVisible();
}

test('sales: a customer, a job order with a deposit, a collection, a release with an invoice record; balance due zero and nothing open in Unpaid customer balances (AR aging)', async ({ page }) => {
  await signIn(page);

  // The job order, with the customer added right on the form.
  await page.getByRole('link', { name: 'Job Orders', exact: true }).click();
  await page.getByRole('button', { name: '+ New Job Order' }).click();
  await page.getByRole('button', { name: '+ New customer' }).click();
  await page.getByLabel("New customer's name").fill(CUSTOMER);
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText(`Added ${CUSTOMER} as a new customer.`)).toBeVisible();
  await page.getByLabel('Line 1 description').fill('Rowing jersey');
  await page.getByLabel('Line 1 pieces').fill('4');
  await page.getByLabel('Line 1 price each').fill('1,500.00');
  await page.getByLabel('Payment terms').selectOption({ label: '50% downpayment' });
  await expect(figure(page, 'Downpayment asked')).toHaveText('₱3,000.00');
  await expect(figure(page, 'Balance due')).toHaveText('₱6,000.00');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog', { name: 'Record this Job Order?' }).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Recorded as JO-000001.')).toBeVisible();

  // A picture of the design, attached to the job order; it opens with the session, as the picture it is.
  const attachments = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Attachments' }) });
  await expect(attachments.getByText('No files attached.')).toBeVisible();
  await attachments.getByLabel('Add a file').setInputFiles({ name: 'jersey design.png', mimeType: 'image/png', buffer: Buffer.from(PIXEL_PNG, 'base64') });
  const picture = attachments.getByRole('link', { name: 'jersey design.png' });
  await expect(picture).toBeVisible();
  await expect(attachments.getByText(/PNG picture · 1 KB · added by /)).toBeVisible();
  // Fetched by the signed-in page itself: the session cookie is Secure, and only the browser sends it on http://127.0.0.1.
  const opened = await page.evaluate(async (href) => {
    const r = await fetch(href, { credentials: 'same-origin' });
    return [r.status, r.headers.get('content-type'), r.headers.get('x-content-type-options'), (await r.arrayBuffer()).byteLength];
  }, (await picture.getAttribute('href'))!);
  expect(opened).toEqual([200, 'image/png', 'nosniff', Buffer.from(PIXEL_PNG, 'base64').length]);

  // The deposit, then the rest: each collection opens filled for this job order.
  await collect(page, 'Take the downpayment', '3,000.00', '401');
  await openJobOrder(page);
  await expect(figure(page, 'Deposits held')).toHaveText('₱3,000.00');
  await collect(page, 'Take a payment', '3,000.00', '402');
  await openJobOrder(page);
  await expect(figure(page, 'Balance due')).toHaveText('₱0.00');

  // The release: everything left is ticked; the owner releases it before it is marked ready; the invoice is to follow.
  await page.getByRole('link', { name: 'Release', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New release slip' })).toBeVisible();
  await expect(page.getByText(`JO-000001 · ${CUSTOMER}`)).toBeVisible();
  await expect(page.getByLabel('Pieces of line 1')).toHaveValue('4');
  await page.getByLabel('Claimed by').fill('Coach Placeholder');
  await page.getByRole('radio', { name: 'School ID' }).click();
  await page.getByLabel("Owner's reason to release it now").fill('Needed for the regatta this weekend');
  await page.getByLabel('Invoice to follow (the booklet is not at hand)').check();
  await expect(figure(page, 'Released now')).toHaveText('₱6,000.00');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog', { name: 'Record this release?' }).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Recorded as REL-000001.')).toBeVisible();

  // The invoice record, from the job order: the release is picked by its number; the booklet figures are shown.
  await page.getByRole('link', { name: 'Open JO-000001' }).click();
  await page.getByRole('link', { name: 'Record invoice' }).click();
  await expect(page.getByText(`REL-000001 · JO-000001 · ${CUSTOMER}`)).toBeVisible();
  await expect(page.getByText('Write these on the booklet')).toBeVisible();
  await expect(figure(page, 'Total')).toHaveText('₱6,000.00');
  await page.getByLabel('Invoice number (from the booklet)').fill('601');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog', { name: 'Record this Invoice Record?' }).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/^Recorded as IR-/)).toBeVisible();

  // Paid in full and invoiced: the balance due is zero and nothing is left to do but close it.
  await page.getByRole('link', { name: 'Open JO-000001' }).click();
  await expect(figure(page, 'Balance due')).toHaveText('₱0.00');
  await expect(figure(page, 'Invoiced')).toHaveText('₱6,000.00');
  await expect(page.getByRole('link', { name: 'Record invoice' })).toHaveCount(0);

  // Unpaid customer balances (AR aging) shows nothing open for the customer.
  await page.getByRole('link', { name: 'Unpaid customer balances (AR aging)' }).click();
  await expect(page.getByRole('cell', { name: 'Total AR' })).toBeVisible();
  await expect(page.getByRole('cell', { name: CUSTOMER })).toHaveCount(0);
});

/** The accountant's decision on the Settings screen: the downpayment VAT mode from today (the password is asked again). */
async function setDepositMode(page: Page, choice: RegExp, saved: RegExp) {
  await page.goto('/acc/settings');
  const panel = page.locator('section, div').filter({ has: page.getByText('Downpayment VAT', { exact: true }) }).last();
  await panel.getByRole('button', { name: 'New version from a date' }).click();
  const dialog = page.getByRole('dialog', { name: 'New version: Downpayment VAT' });
  await dialog.getByLabel('Downpayment VAT').selectOption({ label: (await dialog.getByRole('option', { name: choice }).textContent())! });
  await dialog.getByLabel('Reason').fill('Accountant decision for the shop');
  await dialog.getByRole('button', { name: 'Preview the change' }).click();
  await dialog.getByRole('button', { name: 'Save this version' }).click();
  const password = page.getByRole('dialog', { name: 'Confirm with your password' });
  await password.waitFor({ state: 'visible', timeout: 3000 }).then(async () => {
    await password.getByLabel('Password').fill(OWNER.password);
    await password.getByRole('button', { name: 'Continue' }).click();
  }, () => undefined);
  await expect(page.getByText(saved)).toBeVisible();
}

test('sales, downpayment VAT mode C: the downpayment invoice, its collection, then the release with the balance invoice; balance due zero', async ({ page }) => {
  await signIn(page);
  await setDepositMode(page, /^C:/, /^Saved a new version of Downpayment VAT from/);

  // A second job order for the same customer (found by typing its name).
  await page.getByRole('link', { name: 'Job Orders', exact: true }).click();
  await page.getByRole('button', { name: '+ New Job Order' }).click();
  await page.getByLabel('Customer', { exact: true }).fill('Harbor');
  await page.getByRole('button', { name: /^Harbor Rowing Club/ }).click();
  await page.getByLabel('Line 1 description').fill('Rowing jersey');
  await page.getByLabel('Line 1 pieces').fill('4');
  await page.getByLabel('Line 1 price each').fill('1,500.00');
  await page.getByLabel('Payment terms').selectOption({ label: '50% downpayment' });
  await expect(figure(page, 'Downpayment asked')).toHaveText('₱3,000.00');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog', { name: 'Record this Job Order?' }).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Recorded as JO-000002.')).toBeVisible();

  // The view says the mode in words; "Take the downpayment" opens the downpayment invoice first.
  await expect(page.getByText('Mode C: invoice on downpayment')).toBeVisible();
  await page.getByRole('link', { name: 'Take the downpayment' }).click();
  await expect(page.getByRole('heading', { name: 'New downpayment invoice' })).toBeVisible();
  await expect(page.getByText(`JO-000002 · ${CUSTOMER}`)).toBeVisible();
  await expect(page.getByLabel('Downpayment invoiced (VAT included)')).toHaveValue('3,000.00');
  await page.getByLabel('Invoice number (from the booklet)').fill('701');
  await expect(page.getByText('Write these on the booklet')).toBeVisible();
  await expect(figure(page, 'VATable sales')).toHaveText('₱2,678.57');
  await expect(figure(page, 'VAT')).toHaveText('₱321.43');
  await expect(figure(page, 'Total')).toHaveText('₱3,000.00');
  await expect(figure(page, 'Left to collect')).toHaveText('₱3,000.00');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog', { name: /^Record this/ }).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/^Recorded as IR-/)).toBeVisible();

  // Then its collection, opened for the same job order with the downpayment as the amount.
  await page.getByRole('link', { name: 'Take the downpayment' }).click();
  await fillCollection(page, '3,000.00', '403', 'JO-000002');
  await openJobOrder(page, 'JO-000002');
  await expect(page.getByText('Invoice no. 701')).toBeVisible();
  await expect(figure(page, 'Balance due')).toHaveText('₱3,000.00');
  // The rest is paid as a deposit for the job order.
  await collect(page, 'Take a payment', '3,000.00', '404', 'JO-000002');
  await openJobOrder(page, 'JO-000002');
  await expect(figure(page, 'Deposits held')).toHaveText('₱3,000.00');

  // The release with the balance invoice: the booklet shows the sale less the downpayment invoiced.
  await page.getByRole('link', { name: 'Release', exact: true }).click();
  await expect(page.getByLabel('Pieces of line 1')).toHaveValue('4');
  await page.getByLabel('Claimed by').fill('Coach Placeholder');
  await page.getByRole('radio', { name: 'School ID' }).click();
  await page.getByLabel("Owner's reason to release it now").fill('Needed for the regatta this weekend');
  await page.getByLabel('Invoice number (from the booklet)').fill('702');
  await expect(page.getByText('Less downpayments invoiced')).toBeVisible();
  await expect(figure(page, 'Less downpayments invoiced')).toHaveText('₱3,000.00');
  await expect(figure(page, 'Total')).toHaveText('₱3,000.00');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Record this release?' });
  await expect(confirm.getByText('Less downpayments invoiced')).toBeVisible();
  await confirm.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Recorded as REL-000002.')).toBeVisible();

  // Balance due is zero.
  await page.getByRole('link', { name: 'Open JO-000002' }).click();
  await expect(figure(page, 'Balance due')).toHaveText('₱0.00');
  await expect(figure(page, 'Invoiced')).toHaveText('₱6,000.00');
  await expect(page.getByText('Invoice no. 701')).toBeVisible();

  // Back to the default for the rest of the week.
  await setDepositMode(page, /^A:/, /^Saved a new version of Downpayment VAT from/);
});

test('sales: a job order made from a quotation is filled from it and can be changed before recording', async ({ page }) => {
  await signIn(page);
  // The price list item and the quotation are set up through the same routes the Price list and Quotation screens use
  // (called from the signed-in page, so the session cookie and the CSRF token go with them).
  const call = <T,>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
    page.evaluate(async ({ method, url, body, headers }) => {
      const me = (await (await fetch('/api/auth/me', { credentials: 'same-origin' })).json()) as { csrfToken: string };
      const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { ok: res.ok, json: (await res.json()) as unknown };
    }, { method, url, body, headers }) as Promise<{ ok: boolean; json: T }>;
  const item = (await call<{ id: string }>('POST', '/api/cat/items', { code: 'ROW-01', name: 'Rowing jersey', class: 'made_to_order_garment', garmentType: 'jersey', unit: 'pc', setComponents: 1 })).json;
  expect((await call('POST', `/api/cat/items/${item.id}/prices`, { effectiveFrom: await serverDate(page), minQty: 1, unitPriceCents: 150_000 }, { 'if-match': '1' })).ok).toBe(true);
  const customers = (await call<{ id: string }[]>('GET', '/api/cus/customers?search=Harbor&limit=10')).json;
  const input = { customerId: customers[0]!.id, validForDays: 15, notes: 'Sample notes', lines: [{ itemId: item.id, description: 'Rowing jersey', qty: 3, unit: 'pc', discountCents: 0 }], documentDiscountCents: 0 };
  const quoted = await call<{ id: string }>('POST', '/api/docs/quo.quotation/post', { input, expectedTotalCents: 450_000 }, { 'idempotency-key': 'e2e-quotation-0001' });
  expect(quoted.ok).toBe(true);
  const { id } = quoted.json;

  await page.goto(`/docs/quo.quotation/${id}`);
  await expect(page.getByRole('heading', { name: /QUO-000001/ })).toBeVisible();
  await page.getByRole('button', { name: 'Make a job order' }).click();

  // The form is filled from the quotation.
  await expect(page.getByRole('heading', { name: 'New job order' })).toBeVisible();
  await expect(page.getByText(/^Filled from quotation QUO-000001/)).toBeVisible();
  await expect(page.getByText(CUSTOMER, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Line 1 description')).toHaveValue('Rowing jersey');
  await expect(page.getByLabel('Line 1 pieces')).toHaveValue('3');
  await expect(page.getByLabel('Line 1 price each')).toHaveValue('1,500.00');
  await expect(page.getByLabel('Notes')).toHaveValue('From quotation QUO-000001. Sample notes');

  // Staff change what they need: the pieces and the price, and pick the terms.
  await page.getByLabel('Line 1 pieces').fill('4');
  await page.getByLabel('Line 1 price each').fill('1,400.00');
  await page.getByLabel('Payment terms').selectOption({ label: '50% downpayment' });
  await expect(figure(page, 'Total')).toHaveText('₱5,600.00');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog', { name: 'Record this Job Order?' }).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Recorded as JO-000003.')).toBeVisible();
  await expect(page.getByText('From quotation QUO-000001. Sample notes')).toBeVisible();
});

test('sales: a job order paid by check, then the check deposited from Checks on hand', async ({ page }) => {
  await signIn(page);
  const today = await serverDate(page);

  // A job order paid in full by one check.
  await page.getByRole('link', { name: 'Job Orders', exact: true }).click();
  await page.getByRole('button', { name: '+ New Job Order' }).click();
  await page.getByLabel('Customer', { exact: true }).fill('Harbor');
  await page.getByRole('button', { name: /^Harbor Rowing Club/ }).click();
  await page.getByLabel('Line 1 description').fill('Rowing cap');
  await page.getByLabel('Line 1 pieces').fill('5');
  await page.getByLabel('Line 1 price each').fill('500.00');
  await page.getByLabel('Payment terms').selectOption({ label: '50% downpayment' });
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog', { name: 'Record this Job Order?' }).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Recorded as JO-000004.')).toBeVisible();

  // The collection: the check goes to Checks on hand, with its number, bank and date.
  await page.getByRole('link', { name: 'Take the downpayment' }).click();
  await expect(page.getByRole('heading', { name: 'New collection' })).toBeVisible();
  await page.getByLabel(/^Pay now on JO-000004/).fill('2,500.00');
  await page.getByLabel('Amount', { exact: true }).fill('2,500.00');
  await page.getByRole('radio', { name: /Checks on hand/ }).click();
  await page.getByLabel('Check number').fill('000777');
  await page.getByLabel('Bank of the check').fill('Sample Savings Bank');
  await page.getByLabel('Date on the check').fill(today);
  await page.getByLabel('CR number (from the booklet)').fill('405');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/^Recorded as COL-/)).toBeVisible();
  await openJobOrder(page, 'JO-000004');
  await expect(figure(page, 'Balance due')).toHaveText('₱0.00');

  // Checks on hand lists it, and the books agree; tick it and deposit it to the bank: one fund transfer.
  await page.getByRole('button', { name: 'Close dialog' }).click(); // the job order opened over its list
  await page.getByRole('link', { name: 'Checks on hand', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Checks on hand' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: '000777' });
  await expect(row).toContainText('Sample Savings Bank');
  await expect(row).toContainText('₱2,500.00');
  await expect(figure(page, 'Total of the list')).toHaveText('₱2,500.00');
  await expect(figure(page, 'Checks on hand in the books')).toHaveText('₱2,500.00');
  await page.getByLabel('Deposit check no. 000777').check();
  await page.getByLabel('Deposit to bank').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Deposit the ticked checks' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record this deposit?' });
  await expect(dialog.getByText(/^This will move ₱2,500\.00 from Checks on hand/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/^Deposited 1 check: recorded as TRF-/)).toBeVisible();
  await expect(page.getByText('No customer check is on hand.')).toBeVisible();
  await expect(figure(page, 'Total of the list')).toHaveText('₱0.00');
  await expect(figure(page, 'Checks on hand in the books')).toHaveText('₱0.00');
});
