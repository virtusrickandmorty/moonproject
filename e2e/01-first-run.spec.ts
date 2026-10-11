import { expect, test } from '@playwright/test';
import { MENU_FOLDS_KEY } from '../apps/web/src/shell/menu';
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

const STAFF = { name: 'Sam Encoder', username: 'sam', temporary: 'first little lamp glows', password: 'green kettle sings at dawn' };

test('first run: the owner adds a staff user with a role, who signs in and changes the password at first sign-in', async ({ page }) => {
  // The owner adds the user; the server asks for the owner's password again before it does.
  await signIn(page);
  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a user' }).click();
  await page.getByLabel('Name to show').fill(STAFF.name);
  await page.getByLabel(/^Username/).fill(STAFF.username);
  await page.getByRole('checkbox', { name: /^Sales/ }).check();
  await page.getByLabel(/^Temporary password/).fill(STAFF.temporary);
  await page.getByRole('button', { name: 'Add user' }).click();
  const askAgain = page.getByRole('dialog', { name: 'Confirm with your password' });
  await askAgain.getByLabel(/^Password/).fill(OWNER.password);
  await askAgain.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(`Added ${STAFF.name}.`)).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(STAFF.username) });
  await expect(row).toContainText('Sales');
  await expect(row).toContainText('Must choose a new password at next sign-in');
  await signOut(page);

  // The staff user signs in with the temporary password and must choose their own before anything else.
  await page.getByLabel('Username').fill(STAFF.username);
  await page.getByLabel('Password').fill(STAFF.temporary);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
  await page.getByLabel(/^Temporary password/).fill(STAFF.temporary);
  await page.getByLabel(/^New passphrase/).fill(STAFF.password);
  await page.getByLabel(/^Type the new passphrase again/).fill(STAFF.password);
  await page.getByRole('button', { name: 'Save new passphrase' }).click();
  const menu = page.getByRole('button', { name: `${STAFF.name} ▾` });
  await expect(menu).toBeVisible();
  // An encoder has no Users or Roles screens, and can open the screens of the role.
  await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Customers', exact: true })).toBeVisible();
  // An encoder's menu is long, so it folds once the browser remembers nothing (the specs start with every group open,
  // menu-open.ts): the group of the screen open shows, and a heading opens its group.
  await page.evaluate((key) => localStorage.removeItem(key), MENU_FOLDS_KEY);
  await page.reload();
  await expect(menu).toBeVisible();
  await expect(page.getByRole('link', { name: 'Customers', exact: true })).toBeHidden();
  await page.getByRole('navigation').getByRole('button', { name: 'Sales', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Customers', exact: true })).toBeVisible();

  // The temporary password no longer works; the new one does.
  await menu.click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Username').fill(STAFF.username);
  await page.getByLabel('Password').fill(STAFF.temporary);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Password').fill(STAFF.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: `${STAFF.name} ▾` })).toBeVisible();
});
