/**
 * Readies the practice shop for the every-screen tour (06-every-screen.spec.ts), once, before the roles tour it side by
 * side: open work for the "+ New" forms to pick, a TV user, and backups turned on.
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openWork, signInApi } from './practice-work';
import { ROLES, TV_PASSWORD, practicePasswords, signInAs } from './practice-users';

/** The made-up users the practice data makes have no TV role: the owner adds one, the way the Users screen does. */
async function addTvUser(baseURL: string, ownerPassword: string) {
  const owner = await signInApi(baseURL, 'practice-owner', ownerPassword);
  await owner.post('/api/auth/step-up', { password: ownerPassword });
  const temporary = 'Practice7-tv-lantern-kettle-river!';
  await owner.post('/api/users', { username: 'practice-tv', displayName: 'Practice tv', roles: ['tv'], temporaryPassword: temporary });
  await owner.close();
  const tv = await signInApi(baseURL, 'practice-tv', temporary);
  await tv.post('/api/auth/change-password', { currentPassword: temporary, newPassword: TV_PASSWORD });
  await tv.close();
}

/** The made-up history leaves nothing open, so the tour starts by putting some work in (practice-work.ts). */
async function openWorkForTheTour(baseURL: string, passwords: Record<string, string>) {
  const [owner, production, accountant] = await Promise.all(['owner', 'production', 'accountant'].map((role) => signInApi(baseURL, `practice-${role}`, passwords[role]!)));
  try {
    await openWork(owner!, production!, accountant!);
  } finally {
    await Promise.all([owner, production, accountant].map((s) => s!.close()));
  }
}

/**
 * The owner turns backups on the way 05-backups does, so the Backups screens show a working shop and not the red "Backups are off"
 * every new shop starts with: recovery keys, then the first backup.
 */
async function setUpBackups(page: Page, password: string) {
  await page.getByRole('link', { name: 'Backups', exact: true }).click();
  await page.getByRole('link', { name: 'Recovery keys and folders' }).click();
  await page.getByLabel('Backup folder').fill(join(process.env.E2E_DIR!, 'practice', 'backups'));
  await page.getByLabel('Off-site folder').fill(join(process.env.E2E_DIR!, 'practice', 'offsite'));
  await page.getByRole('button', { name: 'Make new recovery keys' }).click();
  const keyA = await page.getByRole('heading', { name: 'Recovery key A' }).locator('xpath=following-sibling::p[1]').innerText();
  const keyB = await page.getByRole('heading', { name: 'Recovery key B' }).locator('xpath=following-sibling::p[1]').innerText();
  await page.getByLabel(/^Last \d+ characters of key A/).fill(keyA.slice(-8));
  await page.getByLabel(/^Last \d+ characters of key B/).fill(keyB.slice(-8));
  await page.getByRole('button', { name: 'Save the folders and the new keys' }).click();
  await page.getByLabel('Enter your password again to continue').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Saved. New backups are locked with the new recovery keys.')).toBeVisible();
  await page.getByRole('link', { name: 'Status', exact: true }).click();
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/^Backed up: /)).toBeVisible();
}

test('practice shop: open work, a TV user and backups, ready for the tour', async ({ page, baseURL }) => {
  const passwords = practicePasswords();
  await addTvUser(baseURL!, passwords.owner!);
  await openWorkForTheTour(baseURL!, passwords);
  await signInAs(page, ROLES[0]!, passwords.owner!);
  await setUpBackups(page, passwords.owner!);
});
