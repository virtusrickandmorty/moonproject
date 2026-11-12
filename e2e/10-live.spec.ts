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

test('an open report loads again by itself when something is recorded elsewhere, with the same dates', async ({ browser }) => {
  const [a, b] = [await browser.newContext(), await browser.newContext()];
  const [reading, adding] = [await a.newPage(), await b.newPage()];
  await signIn(reading);
  await signIn(adding);
  await reading.goto('/rpt/trial-balance');
  await expect(reading.getByLabel('As of')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/); // the server's today, once it is known
  const asOf = await reading.getByLabel('As of').inputValue();

  // The whole ERP is live (the owner's request, Oct 2026): the report asks for its figures again, with its dates.
  const again = reading.waitForRequest((r) => r.url().includes('/trial-balance?') && r.url().includes(`asOf=${asOf}`), { timeout: 15_000 });
  await adding.goto('/cus');
  await adding.getByRole('button', { name: '+ New customer' }).click();
  await adding.getByLabel(/^Display name/).fill('Live Report Club');
  await adding.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(adding.getByRole('heading', { name: /^Live Report Club · / })).toBeVisible();
  await again;
  await expect(reading.getByText('New entries were recorded since you opened this report.')).toHaveCount(0);
  expect(await reading.getByLabel('As of').inputValue()).toBe(asOf);
  await a.close();
  await b.close();
});

/**
 * Two tabs of one browser keep one bell (the owner's report, Nov 2026: a duplicated tab went quiet after its notifications
 * were read, while the first tab kept ringing for them). A read mark is not a recorded change, so the tab that read them
 * tells the others. The notifications here are made up for the test.
 */
test('notifications read in one tab are read in the other tab of the same browser too, without reloading', async ({ browser }) => {
  const context = await browser.newContext();
  let unread = [{ id: 'test:one', kind: 'test', label: 'A made-up notification', read: false, at: '2026-11-12T01:00:00.000Z' }];
  await context.route('**/api/dash/notifications?*', (route) => route.fulfill({ json: unread }));
  await context.route('**/api/dash/notifications/read', (route) => { unread = []; return route.fulfill({ json: { ok: true } }); });
  // No live stream here: only what the tab that read them tells the other may update it (a change recorded meanwhile would too).
  await context.route('**/api/live', (route) => route.abort());
  const [first, second] = [await context.newPage(), await context.newPage()];
  await signIn(first);
  await second.goto('/');
  for (const tab of [first, second]) await expect(tab.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();

  await second.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  await second.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(second.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(first.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible({ timeout: 5_000 });
  await context.close();
});
