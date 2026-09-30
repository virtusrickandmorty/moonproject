import { expect, test } from '@playwright/test';
import { OWNER, signIn } from './shop';

test('backups: back up now, then a restore drill on that backup', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Backups', exact: true }).click();
  await page.getByRole('link', { name: 'Recovery keys and folders' }).click();

  // Backups are off until the owner has printed two recovery keys and typed a few characters of each back.
  await expect(page.getByText('No recovery keys yet, so backups are off.')).toBeVisible();
  await page.getByLabel('Backup folder').fill(process.env.E2E_DIR + '/backups');
  await page.getByRole('button', { name: 'Make new recovery keys' }).click();
  const keyA = await page.getByRole('heading', { name: 'Recovery key A' }).locator('xpath=following-sibling::p[1]').innerText();
  const keyB = await page.getByRole('heading', { name: 'Recovery key B' }).locator('xpath=following-sibling::p[1]').innerText();
  expect(keyA).toMatch(/^AGE-SECRET-KEY-1/);
  await page.getByLabel(/^Last \d+ characters of key A/).fill(keyA.slice(-8));
  await page.getByLabel(/^Last \d+ characters of key B/).fill(keyB.slice(-8));
  await page.getByRole('button', { name: 'Save the folders and the new keys' }).click();
  await page.getByLabel('Enter your password again to continue').fill(OWNER.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Saved. New backups are locked with the new recovery keys.')).toBeVisible();

  // Back up now.
  await page.getByRole('link', { name: 'Status', exact: true }).click();
  await expect(page.getByText('No backup has worked yet.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/^Backed up: /)).toBeVisible();
  await expect(page.getByText('No backup has worked yet.', { exact: true })).toBeHidden();
  const drill = page.getByText('Last restore drill', { exact: true }).locator('xpath=following-sibling::dd[1]');
  await expect(drill).toHaveText('Never');

  // The restore drill on that backup: it opens the copy with recovery key A, checks it, and stops there.
  await page.getByRole('link', { name: 'Restore and drill' }).click();
  await page.getByRole('button', { name: 'Run drill' }).first().click();
  await page.getByLabel('Recovery key A or B').fill(keyA);
  await page.getByRole('button', { name: 'Open the backup' }).click();
  await page.getByLabel('Enter your password again to continue').fill(OWNER.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Drill passed. It is recorded as the latest restore drill.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore this backup' })).toBeHidden();

  // The drill is recorded on the status page.
  await page.getByRole('link', { name: 'Status', exact: true }).click();
  await expect(drill).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(/);
});
