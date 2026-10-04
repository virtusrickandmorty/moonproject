import { expect, test } from '@playwright/test';
import { signIn } from './shop';

test('a wrong entry turns its own box red with what to type, and typing again clears it', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await page.getByRole('button', { name: '+ New customer' }).click();
  await page.getByLabel(/^Display name/).fill('Wrong Email Test');
  const email = page.locator('input[type=email]'); // its label also holds the message once refused, so not found by label then
  const notes = page.getByLabel('Notes', { exact: true });
  await email.fill('not an email');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const refused = page.locator('label[data-invalid]');
  await expect(refused).toHaveCount(1);
  await expect(refused).toContainText('Type an email like name@example.com.');
  await expect(refused.locator('input')).toHaveAttribute('type', 'email');
  const border = (box: typeof email) => box.evaluate((e) => getComputedStyle(e).borderColor);
  expect(await border(email)).not.toBe(await border(notes));

  await email.fill('maria@example.com');
  await expect(refused).toHaveCount(0);
  await email.blur();
  expect(await border(email)).toBe(await border(notes));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
