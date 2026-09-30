import { expect, test } from '@playwright/test';
import { OWNER, signIn } from './shop';

test('customer emails: off until configured; the owner saves the settings with a fresh password; the App Password is never shown back', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Customer email settings', exact: true }).click();
  await expect(page.getByText('Sending is OFF. No customer is emailed until you turn it on.')).toBeVisible();

  // Sending cannot be turned on before the mail server, the sender and the App Password are filled in.
  await page.getByLabel('Send emails to customers who agreed to them').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Enter your password again to continue').fill(OWNER.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/Sending cannot be turned on yet\. Still needed: the mail server/)).toBeVisible();
  await page.getByLabel('Send emails to customers who agreed to them').uncheck();

  // Saved with sending off: no network is used.
  await page.getByLabel(/^Mail server/).fill('smtp.example.test');
  await page.getByLabel('User name').fill('shop@example.test');
  await page.getByLabel('Sender name').fill('Virtus Garments');
  await page.getByLabel('Sender address').fill('shop@example.test');
  await page.getByLabel('App Password').fill('abcd efgh ijkl mnop');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Enter your password again to continue').fill(OWNER.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(page.getByText('One is saved. Type a new one only to replace it. It is never shown again.')).toBeVisible();
  await expect(page.getByLabel('App Password')).toHaveValue('');
  await expect(page.getByText('Sending is OFF. No customer is emailed until you turn it on.')).toBeVisible();

  // The outbox is empty, and says who may get an email.
  await page.getByRole('link', { name: 'Customer emails', exact: true }).click();
  await expect(page.getByText('No emails here yet.')).toBeVisible();
  await expect(page.getByText(/Only customers who agreed to emails/)).toBeVisible();

  // The same screen shows payslip emails, and filters by kind.
  await page.getByRole('button', { name: 'Payslip emails' }).click();
  await expect(page.getByRole('heading', { name: 'Payslip emails', exact: true })).toBeVisible();
  await expect(page.getByText('No emails here yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Customer emails', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customer emails', exact: true })).toBeVisible();
});
