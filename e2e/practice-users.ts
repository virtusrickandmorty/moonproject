/**
 * The practice shop's made-up users, one for each default role, and how each signs in. serve-practice.ts writes their
 * passwords to E2E_DIR/practice-passwords.json; the TV user is the one the tour's setup adds (06-every-screen.setup.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

export interface Who { role: string; username: string; name: string }

export const ROLES: Who[] = [
  { role: 'owner', username: 'practice-owner', name: 'Practice Owner' },
  { role: 'accountant', username: 'practice-accountant', name: 'Practice accountant' },
  { role: 'encoder', username: 'practice-encoder', name: 'Practice encoder' },
  { role: 'production', username: 'practice-production', name: 'Practice production' },
  { role: 'tv', username: 'practice-tv', name: 'Practice tv' },
];

/** The TV user's password after its first sign-in, when it changes the temporary one the owner gave it. */
export const TV_PASSWORD = 'Practice8-tv-river-kettle-lantern!';

/** Each role's password, by role. */
export function practicePasswords(): Record<string, string> {
  return { ...(JSON.parse(readFileSync(join(process.env.E2E_DIR!, 'practice-passwords.json'), 'utf8')) as Record<string, string>), tv: TV_PASSWORD };
}

export async function signInAs(page: Page, who: Who, password: string) {
  await page.goto('/sign-in'); // "/" is the public shop to someone signed out
  await page.getByLabel('Username').fill(who.username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: new RegExp(`${who.name} ▾`) })).toBeVisible();
}
