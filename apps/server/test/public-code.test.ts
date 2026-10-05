/**
 * The repository became public on 29 Sep 2026 (K39): checks written the way someone who has read the code would try to
 * get in. Each test failed before its fix.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadModules } from '../src/modules/load.ts';
import { openDb } from '../src/platform/db/driver.ts';
import { tx } from '../src/platform/db/driver.ts';
import { copySignIns, syncSignInsOnLogin } from '../src/platform/practice/shop.ts';
import { PASSWORD, TEST_SCRYPT_N, createTestEnv, createUser } from './helpers.ts';
import { world } from '../src/modules/PAY/tests/world.ts';
import { addPrior, updatePrior } from '../src/modules/PAY/prior.ts';

describe('the practice shop keeps its walls', () => {
  it('refuses backups and restores however the address is written', async () => {
    const env = await createTestEnv(undefined, { practice: true });
    const owner = await env.as('owner');
    for (const url of ['/api/bak/status', '/api/%62ak/status', '/api/b%61k/status', '/api/%62%61%6b/backups']) {
      const r = await owner.get(url);
      expect([url, r.statusCode, r.json().code]).toEqual([url, 403, 'PRACTICE']);
    }
    const usb = await owner.post('/api/%62ak/usb', { drive: 'A', dir: 'practice-usb' });
    expect([usb.statusCode, usb.json().code]).toEqual([403, 'PRACTICE']);
  });

  it('copies the real sign-ins before every practice sign-in, even with a query on the address', async () => {
    const modules = await loadModules();
    const real = await createTestEnv();
    const jun = createUser(real.db, 'jun', ['accountant']);
    const practiceDb = openDb(':memory:');
    const { app } = buildApp({ db: practiceDb, clock: real.clock, modules, practice: true, config: { scryptN: TEST_SCRYPT_N } });
    copySignIns(real.db, practiceDb);
    syncSignInsOnLogin(app, real.db, practiceDb);
    await app.ready();
    // Jun leaves: the owner switches the account off in the real shop.
    real.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(jun);
    for (const url of ['/api/auth/login?x=1', '/api/auth/%6cogin', '/api/auth/login']) {
      const r = await app.inject({ method: 'POST', url, payload: { username: 'jun', password: PASSWORD } });
      expect([url, r.statusCode]).toEqual([url, 401]);
    }
    await app.close();
  });
});

describe('request checks', () => {
  it('refuses a change with a malformed Origin as a wrong origin, not a server error', async () => {
    const env = await createTestEnv();
    const enc = await env.as('encoder');
    for (const origin of ['null', 'not a url']) {
      const r = await enc.post('/api/drafts', { docType: 'cash.transfer', payload: {} }, { origin });
      expect([origin, r.statusCode, r.json().code]).toEqual([origin, 403, 'BAD_ORIGIN']);
      const login = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'x', password: 'y' }, headers: { origin } });
      expect([origin, login.statusCode, login.json().code]).toEqual([origin, 403, 'BAD_ORIGIN']);
    }
  });

  it('tells browsers never to show the app inside another site, nor to guess content types', async () => {
    const env = await createTestEnv();
    for (const url of ['/api/health', '/api/auth/me', '/jo/orders']) {
      const r = await env.app.inject({ method: 'GET', url });
      expect(r.headers['x-frame-options'], url).toBe('DENY');
      expect(r.headers['content-security-policy'], url).toBe("frame-ancestors 'none'");
      expect(r.headers['x-content-type-options'], url).toBe('nosniff');
      expect(r.headers['referrer-policy'], url).toBe('same-origin');
    }
  });
});

describe('backups stay on this PC', () => {
  it('refuses a network folder for the USB copy', async () => {
    const env = await createTestEnv();
    const accountant = await env.as('accountant');
    for (const dir of ['\\\\attacker.example\\share', '//attacker.example/share', ' \\\\?\\UNC\\attacker.example\\share']) {
      const r = await accountant.post('/api/bak/usb', { drive: 'A', dir });
      expect([dir, r.statusCode, r.json().code]).toEqual([dir, 400, 'INVALID_INPUT']);
    }
    expect(env.db.prepare('SELECT COUNT(*) FROM bak_usb_copies').pluck().get()).toBe(0);
  });
});

describe('pay amounts stay out of the audit trail (C6, N-05)', () => {
  it('names the amounts of pay before Virtus, never their values', async () => {
    const w = await world('2026-12-01');
    const olga = w.person('Olga Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 }, { costCentre: 'office' });
    const amounts = { benefitsCents: 0, deMinimisCents: 0, sssCents: 1_650_123, phicCents: 825_456, hdmfCents: 220_789, otherNontaxCents: 0, taxableCents: 30_305_321, wtaxCents: 4_000_654 };
    const grossCents = 1_650_123 + 825_456 + 220_789 + 30_305_321;
    const row = tx(w.db, () => addPrior(w.db, { employeeId: olga, year: 2026, source: 'before', ...amounts, grossCents }, w.who()));
    tx(w.db, () => updatePrior(w.db, row.id, '1', { wtaxCents: 3_999_987, note: 'Checked against the old payroll (made up)' }, w.who()));
    const data = w.db.prepare(`SELECT data FROM audit_log WHERE entity_type = 'pay.prior' ORDER BY seq`).pluck().all() as string[];
    expect(data).toHaveLength(2);
    for (const figure of [grossCents, ...Object.values(amounts).filter(Boolean), 3_999_987]) {
      for (const d of data) expect(d).not.toContain(String(figure));
    }
    expect(JSON.parse(data[0]!)).toMatchObject({ employeeId: olga, year: 2026, source: 'before', amounts: expect.arrayContaining(['grossCents', 'wtaxCents']) });
    expect(JSON.parse(data[1]!)).toMatchObject({ changes: { note: { before: null, after: 'Checked against the old payroll (made up)' } }, amounts: ['wtaxCents'] });
  });

  it('keeps imported daily and piece rates out of the import review entries', async () => {
    const env = await createTestEnv();
    const owner = await env.as('owner');
    const up = await owner.post('/api/mig/upload', { filename: 'employees.csv', csv: 'Employee_ID,Employee_Name,Daily_Rate\nE20,Example Worker,600.50\nE21,Second Worker,abc' });
    const rows = (await owner.get(`/api/mig/uploads/${up.json().uploadId}/review`)).json().rows as { id: string }[];
    expect((await owner.post(`/api/mig/rows/${rows[0]!.id}/accept`, {})).statusCode).toBe(200);
    expect((await owner.post(`/api/mig/rows/${rows[1]!.id}/fix`, { manualData: { rateCents: 72525 } })).statusCode).toBe(200);
    const data = env.db.prepare(`SELECT data FROM audit_log WHERE action LIKE 'mig.row.%' ORDER BY seq`).pluck().all() as string[];
    expect(data).toHaveLength(2);
    for (const d of data) {
      expect(d).not.toContain('60050');
      expect(d).not.toContain('72525');
    }
    expect(JSON.parse(data[1]!)).toMatchObject({ before: { status: 'needs_review', rate: false }, after: { status: 'accepted', rate: true, manualData: { rateCents: 'set' } } });
  });
});
