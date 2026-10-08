import { expect, test } from '@playwright/test';
import { signIn } from './shop';

test('a quick sale is recorded with its collection', async ({ page }) => {
  await signIn(page);

  // A customer, added on the Customers screen.
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await page.getByRole('button', { name: '+ New customer' }).click();
  await page.getByLabel('Display name').fill('Test School');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: /^Test School · / })).toBeVisible();
  // The saved customer opens in a pop-up over the list; close it to go on.
  await page.getByRole('dialog', { name: /^Test School · / }).getByRole('button', { name: 'Close', exact: true }).click();

  // The sale: one repair line, paid in cash. One payment with no amount typed pays the exact total.
  await page.getByRole('link', { name: 'Quick Sales' }).click();
  await page.getByRole('button', { name: '+ New Quick Sale' }).click();
  await page.getByLabel('Customer').fill('Test');
  await page.getByRole('button', { name: /^Test School/ }).click();
  await page.getByLabel('What', { exact: true }).fill('Shorten sleeves');
  await page.getByLabel('Price each').fill('1,120.00');
  await page.getByLabel('Invoice number (from the booklet)').fill('501');
  await page.getByRole('radio', { name: /^Cash on hand/ }).click();
  await page.getByLabel('CR number (from the booklet)').fill('301');
  await expect(page.getByText('₱1,120.00').first()).toBeVisible();
  await page.getByRole('button', { name: 'Record', exact: true }).click();

  // The confirm dialog says what to write on the booklet.
  const dialog = page.getByRole('dialog', { name: 'Record this quick sale?' });
  await expect(dialog.getByText('Write these on the booklet')).toBeVisible();
  await dialog.getByRole('button', { name: 'Record', exact: true }).click();

  // The recorded sale and its collection.
  await expect(page.getByText('Recorded', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Shorten sleeves/ })).toBeVisible();
  await expect(page.getByText(/Paid by .* \(CR 301\), ₱1,120\.00/)).toBeVisible();

  // The money is in the cash box (the sale opened over its list; close it first).
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Cash Accounts' }).click();
  await expect(page.getByRole('row', { name: /^Cash on hand/ })).toContainText('₱1,120.00');
});
