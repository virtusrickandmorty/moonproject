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
