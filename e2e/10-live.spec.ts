import { expect, test } from '@playwright/test';
import { signIn } from './shop';

/** Live changes: what one computer records shows on another's open screen, without reloading. */
test('a customer added on one computer appears on the customer list open on another, without reloading', async ({ browser }) => {
  const [a, b] = [await browser.newContext(), await browser.newContext()];
  const [watching, adding] = [await a.newPage(), await b.newPage()];
  await signIn(watching);
  await signIn(adding);
  await watching.goto('/cus');
  await expect(watching.getByText('Live Test Club')).toHaveCount(0);

  await adding.goto('/cus');
  await adding.getByRole('button', { name: '+ New customer' }).click();
  await adding.getByLabel(/^Display name/).fill('Live Test Club');
  await adding.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(adding.getByRole('heading', { name: /^Live Test Club · / })).toBeVisible();

  // The other computer's list shows it by itself (no reload, no click).
  await expect(watching.getByText('Live Test Club').first()).toBeVisible({ timeout: 10_000 });
  await a.close();
  await b.close();
});

test('an open report stays as it is when something is recorded elsewhere, and offers Refresh', async ({ browser }) => {
  const [a, b] = [await browser.newContext(), await browser.newContext()];
  const [reading, adding] = [await a.newPage(), await b.newPage()];
  await signIn(reading);
  await signIn(adding);
  await reading.goto('/rpt/trial-balance');
  await expect(reading.getByText('New entries were recorded since you opened this report.')).toHaveCount(0);

  await adding.goto('/cus');
  await adding.getByRole('button', { name: '+ New customer' }).click();
  await adding.getByLabel(/^Display name/).fill('Live Report Club');
  await adding.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(adding.getByRole('heading', { name: /^Live Report Club · / })).toBeVisible();

  const bar = reading.getByText('New entries were recorded since you opened this report.');
  await expect(bar).toBeVisible({ timeout: 10_000 });
  await reading.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await a.close();
  await b.close();
});
