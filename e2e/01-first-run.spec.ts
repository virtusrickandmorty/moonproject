import { expect, test } from '@playwright/test';
import { OWNER, signIn, signOut } from './shop';

test('first run: the first owner is set up, signs out and signs in again', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create the first owner' })).toBeVisible();
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Username').fill(OWNER.username);
  await page.getByLabel(/^Passphrase/).fill(OWNER.password);
  await page.getByLabel('Type the passphrase again').fill(OWNER.password);
  await page.getByRole('button', { name: 'Create owner and sign in' }).click();
  await expect(page.getByRole('button', { name: `${OWNER.name} ▾` })).toBeVisible();
  await signOut(page);
  await signIn(page);
});

// Not done in the browser: there is no Users or Roles screen in the web app yet (the server has /api/users and /api/roles),
// so a staff user cannot be added, given a role, or signed in with a first-sign-in password change from a browser.
test.fixme('first run: the owner adds a staff user with a role, who signs in and changes the password at first sign-in', async () => {});
