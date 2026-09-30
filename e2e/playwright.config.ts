/**
 * End-to-end browser tests (PLAN I1 item 6). Starts the real server on an empty database in a temporary folder (serve.ts)
 * with the built web app (apps/web/dist), then drives Chromium as staff do. `npm run e2e` builds the web app first.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/** One temporary folder for the whole run: the workers, the server and the teardown all inherit it. */
process.env.E2E_DIR ??= mkdtempSync(join(tmpdir(), 'moonproject-e2e-'));
const PORT = Number(process.env.E2E_PORT ?? 3199);
/** Where Chromium is already installed (a container), otherwise Playwright's own copy (`npx playwright install chromium`). */
const executablePath = process.env.E2E_CHROMIUM || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // The tests share one shop, one after another: each builds on the ones before it, as a week at the shop does.
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  globalTeardown: './teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npx tsx e2e/serve.ts',
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { PORT: String(PORT), E2E_DIR: process.env.E2E_DIR },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
