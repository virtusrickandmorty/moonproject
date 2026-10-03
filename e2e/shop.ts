/** What the tests share: the made-up owner of the empty shop, and signing in as staff do. */
import { expect, type Page } from '@playwright/test';

export const OWNER = { name: 'Olive Owner', username: 'olive', password: 'blue lantern rides the tide' };

export async function signIn(page: Page, username = OWNER.username, password = OWNER.password) {
  await page.goto('/sign-in');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: new RegExp(OWNER.name) })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: new RegExp(`${OWNER.name} ▾`) }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

/** The server date the shop screens show, as YYYY-MM-DD (the server's Manila date, never the test PC's). */
export async function serverDate(page: Page): Promise<string> {
  const health = await (await page.request.get('/api/health')).json() as { serverTime: string };
  return health.serverTime.slice(0, 10);
}
