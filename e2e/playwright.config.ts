/**
 * End-to-end browser tests (PLAN I1 item 6). Starts the real server on an empty database in a temporary folder (serve.ts)
 * with the built web app (apps/web/dist), then drives Chromium as staff do. `npm run e2e` builds the web app first.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { menuOpenAt } from './menu-open';

/** One temporary folder for the whole run: the workers, the server and the teardown all inherit it. */
process.env.E2E_DIR ??= mkdtempSync(join(tmpdir(), 'moonproject-e2e-'));
const PORT = Number(process.env.E2E_PORT ?? 3199);
/** The practice shop (06-every-screen): its own server, on made-up data, beside the empty shop the other specs share. */
const PRACTICE_PORT = Number(process.env.E2E_PRACTICE_PORT ?? 3198);
/** Where Chromium is already installed (a container), otherwise Playwright's own copy (`npx playwright install chromium`). */
const executablePath = process.env.E2E_CHROMIUM || undefined;
/**
 * Each browser starts with every menu group opened (they start folded; the tests click links in all of them) and with the
 * pop-up messages off, so a message is found once, on the page (components/Toasts.tsx).
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // The empty shop's tests share it, one after another: each builds on the ones before it, as a week at the shop does.
  // Beside them, the practice shop's roles tour it side by side (06-every-screen), so the run stays inside CI's 10 minutes.
  fullyParallel: false,
  workers: 4,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  globalTeardown: './teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    storageState: menuOpenAt(`http://127.0.0.1:${PORT}`),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'chromium', testIgnore: /06-every-screen\.spec\.ts/, workers: 1, use: { browserName: 'chromium' } },
    { name: 'practice-setup', testMatch: /06-every-screen\.setup\.ts/, use: { browserName: 'chromium', baseURL: `http://127.0.0.1:${PRACTICE_PORT}`, storageState: menuOpenAt(`http://127.0.0.1:${PRACTICE_PORT}`), actionTimeout: 10_000 } },
    { name: 'practice', testMatch: /06-every-screen\.spec\.ts/, dependencies: ['practice-setup'], fullyParallel: true, use: { browserName: 'chromium', baseURL: `http://127.0.0.1:${PRACTICE_PORT}`, storageState: menuOpenAt(`http://127.0.0.1:${PRACTICE_PORT}`), actionTimeout: 10_000 } },
  ],
  webServer: [
    {
      command: 'npx tsx e2e/serve.ts',
      cwd: '..',
      url: `http://127.0.0.1:${PORT}/api/health`,
      env: { PORT: String(PORT), E2E_DIR: process.env.E2E_DIR },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npx tsx e2e/serve-practice.ts',
      cwd: '..',
      url: `http://127.0.0.1:${PRACTICE_PORT}/api/health`,
      env: { PORT: String(PRACTICE_PORT), E2E_DIR: process.env.E2E_DIR },
      reuseExistingServer: false,
      timeout: 240_000, // making 30 days of made-up data comes first
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
