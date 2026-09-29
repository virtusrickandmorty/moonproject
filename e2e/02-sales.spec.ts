import { expect, test, type Page } from '@playwright/test';
import { signIn } from './shop';

const CUSTOMER = 'Harbor Rowing Club';

/** The "So far" / money figures: the amount shown beside a label. */
const figure = (page: Page, label: string) => page.locator('dt', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::dd[1]');

async function openJobOrder(page: Page) {
  await page.getByRole('link', { name: 'Job Orders', exact: true }).click();
  await page.getByRole('link', { name: 'JO-000001' }).click();
  await expect(page.getByRole('heading', { name: 'Job Order JO-000001' })).toBeVisible();
}

async function collect(page: Page, button: string, amount: string, cr: string) {
  await page.getByRole('link', { name: button }).click();
  await expect(page.getByRole('heading', { name: 'New collection' })).toBeVisible();
  await expect(page.getByText(CUSTOMER, { exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Pay now on JO-000001/)).toHaveValue(amount);
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue(amount);
  await page.getByRole('radio', { name: /GCash/ }).click();
  await page.getByLabel('CR number (from the booklet)').fill(cr);
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/^Recorded as COL-/)).toBeVisible();
}

test('sales: a customer, a job order with a deposit, a collection, a release with an invoice record; balance due zero and nothing open in AR aging', async ({ page }) => {
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

  // AR aging shows nothing open for the customer.
  await page.getByRole('link', { name: 'AR aging' }).click();
  await expect(page.getByRole('cell', { name: 'Total AR' })).toBeVisible();
  await expect(page.getByRole('cell', { name: CUSTOMER })).toHaveCount(0);
});
