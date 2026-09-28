/**
 * System Health (PLAN C8, platform/health): every light's thresholds, the nightly check's timing, the routes and who
 * may use them, the stored system check, and a support file with no personal data.
 */
import { describe, expect, it } from 'vitest';
import { manilaTimestamp } from '@moonproject/shared';
import { healthLights, isCheckDue, overallLight, type HealthFacts, type Host, type StoredCheck } from '../src/platform/health/health.ts';
import { createTestEnv, createUser } from './helpers.ts';

const NOW = '2026-09-28T10:00:00.000+08:00';
const ago = (hours: number) => manilaTimestamp(new Date(Date.parse(NOW) - hours * 3600_000));
const DAYS = 24;

const goodCheck = (at = ago(8)): StoredCheck => ({
  at, reason: 'schedule', ok: true,
  results: {
    database: { ok: true, problems: [] },
    audit: { ok: true, brokenAt: null, entries: 120 },
    ledger: [{ id: 'L1', name: 'Balanced and sealed journals', ok: true, problems: [] }, { id: 'L7', name: 'Gapless document numbers', ok: true, problems: [] }],
  },
});

const allGood = (): HealthFacts => ({
  now: NOW, practice: false,
  backups: { on: true, offsiteSet: true, lastOkAt: ago(1), lastFailed: null, lastOffsiteAt: ago(2), lastDrillAt: ago(30 * DAYS), usb: { A: ago(3 * DAYS), B: ago(10 * DAYS) } },
  freeBytes: 120e9, lastAuditAt: ago(0.5), lastCheck: goodCheck(),
  host: { platform: 'win32', release: '10.0.26100', utcOffsetMinutes: 480 }, version: '0.1.20', practiceShop: { state: 'ready', port: 8443, preparedAt: null, days: 30, message: null },
});

const light = (f: HealthFacts, key: string) => {
  const l = healthLights(f).find((x) => x.key === key);
  return l && [l.light, l.message];
};

describe('System Health lights', () => {
  it('are all green on a well-kept shop server, the version aside', () => {
    const lights = healthLights(allGood());
    expect(lights.map((l) => `${l.key} ${l.light}`)).toEqual([
      'backups green', 'offsite green', 'usb green', 'drill green', 'disk green', 'clock green', 'check green',
      'database green', 'books green', 'audit green', 'windows green', 'practice green', 'version grey',
    ]);
    expect(overallLight(lights)).toBe('green');
    expect(light(allGood(), 'usb')).toEqual(['green', 'Drive A was last copied on 2026-09-25 10:00, drive B on 2026-09-18 10:00.']);
    expect(light(allGood(), 'disk')).toEqual(['green', '120.0 GB free on the drive with the database.']);
  });

  it('turns backups red when off, missing or more than a day old, and amber when the newest run failed', () => {
    const f = allGood();
    expect(light({ ...f, backups: { ...f.backups!, on: false } }, 'backups')?.[0]).toBe('red');
    expect(light({ ...f, backups: { ...f.backups!, lastOkAt: null } }, 'backups')?.[0]).toBe('red');
    expect(light({ ...f, backups: { ...f.backups!, lastOkAt: ago(27) } }, 'backups')).toEqual(['red', 'The last good backup was on 2026-09-27 07:00, more than a day ago. Open Backups and back up now.']);
    expect(light({ ...f, backups: { ...f.backups!, lastOkAt: ago(25) } }, 'backups')?.[0]).toBe('green');
    expect(light({ ...f, backups: { ...f.backups!, lastOkAt: ago(3), lastFailed: { at: ago(1), error: 'BACKUP_CHECK' } } }, 'backups')?.[0]).toBe('amber');
    expect(light({ ...f, backups: { ...f.backups!, lastOkAt: ago(1), lastFailed: { at: ago(3), error: 'BACKUP_CHECK' } } }, 'backups')?.[0]).toBe('green');
  });

  it('watches the off-site copy, the USB drives and the restore drill', () => {
    const f = allGood();
    const b = f.backups!;
    expect(light({ ...f, backups: { ...b, offsiteSet: false, lastOffsiteAt: null } }, 'offsite')?.[0]).toBe('red');
    expect(light({ ...f, backups: { ...b, lastOffsiteAt: null } }, 'offsite')?.[0]).toBe('red');
    expect(light({ ...f, backups: { ...b, lastOffsiteAt: ago(30) } }, 'offsite')?.[0]).toBe('amber');
    expect(light({ ...f, backups: { ...b, lastOffsiteAt: ago(8 * DAYS) } }, 'offsite')?.[0]).toBe('red');
    expect(light({ ...f, backups: { ...b, usb: { A: null, B: null } } }, 'usb')?.[0]).toBe('amber');
    expect(light({ ...f, backups: { ...b, usb: { A: ago(9 * DAYS), B: null } } }, 'usb')?.[0]).toBe('amber');
    expect(light({ ...f, backups: { ...b, usb: { A: ago(16 * DAYS), B: ago(20 * DAYS) } } }, 'usb')?.[0]).toBe('red');
    expect(light({ ...f, backups: { ...b, lastDrillAt: null } }, 'drill')?.[0]).toBe('amber');
    expect(light({ ...f, backups: { ...b, lastDrillAt: ago(93 * DAYS) } }, 'drill')?.[0]).toBe('amber');
  });

  it('warns on low disk space and a clock that went back or a Windows time zone that is not UTC+8', () => {
    const f = allGood();
    expect(light({ ...f, freeBytes: 1.5e9 }, 'disk')?.[0]).toBe('red');
    expect(light({ ...f, freeBytes: 8e9 }, 'disk')).toEqual(['amber', '8.0 GB free on the drive with the database. Free up some space soon.']);
    expect(light({ ...f, freeBytes: null }, 'disk')?.[0]).toBe('grey');
    expect(light({ ...f, lastAuditAt: manilaTimestamp(new Date(Date.parse(NOW) + 10 * 60_000)) }, 'clock')).toEqual([
      'red', "The PC's clock (2026-09-28 10:00) is behind the last recorded entry (2026-09-28 10:10). Recording is blocked until the Windows date and time are fixed.",
    ]);
    expect(light({ ...f, lastAuditAt: manilaTimestamp(new Date(Date.parse(NOW) + 2 * 60_000)) }, 'clock')?.[0]).toBe('green'); // within the tolerance
    expect(light({ ...f, host: { ...f.host, utcOffsetMinutes: 0 } }, 'clock')?.[1]).toContain('Windows is set to UTC+00:00, not UTC+08:00');
    expect(light({ ...f, host: { ...f.host, platform: 'linux', utcOffsetMinutes: 0 } }, 'clock')?.[0]).toBe('green');
  });

  it('reads the database, books and audit trail from the newest system check, and asks for one when it is missing or old', () => {
    const f = allGood();
    const none = healthLights({ ...f, lastCheck: null });
    expect(none.filter((l) => ['check', 'database', 'books', 'audit'].includes(l.key)).map((l) => l.light)).toEqual(['amber', 'grey', 'grey', 'grey']);
    expect(light({ ...f, lastCheck: goodCheck(ago(37)) }, 'check')?.[0]).toBe('amber');
    const bad = goodCheck();
    bad.results.ledger[0] = { id: 'L1', name: 'Balanced and sealed journals', ok: false, problems: ['Journal JE-000007 is unbalanced or unsealed'] };
    bad.results.audit = { ok: false, brokenAt: 57, entries: 120 };
    bad.results.database = { ok: false, problems: ['3 rows point at records that do not exist'] };
    const lights = healthLights({ ...f, lastCheck: bad });
    expect(lights.find((l) => l.key === 'books')).toMatchObject({ light: 'red', message: 'Balanced and sealed journals: Journal JE-000007 is unbalanced or unsealed. Open Integrity check for the details.' });
    expect(lights.find((l) => l.key === 'audit')?.light).toBe('red');
    expect(lights.find((l) => l.key === 'database')?.light).toBe('red');
    expect(overallLight(lights)).toBe('red');
  });

  it('flags Windows 10 before and after its last security updates, and says nothing of Windows off Windows', () => {
    const f = allGood();
    const win10 = { ...f.host, release: '10.0.19045' };
    expect(light({ ...f, host: win10 }, 'windows')?.[0]).toBe('amber');
    expect(light({ ...f, host: win10, now: '2026-10-14T09:00:00.000+08:00' }, 'windows')?.[0]).toBe('red');
    expect(light(f, 'windows')).toEqual(['green', 'Windows 11 (build 26100).']);
    expect(light({ ...f, host: { ...f.host, platform: 'linux' } }, 'windows')?.[0]).toBe('grey');
  });

  it('shows the practice shop beside the real one, and in the practice shop says it is not backed up', () => {
    const f = allGood();
    expect(light({ ...f, practiceShop: { state: 'failed', port: 8443, preparedAt: null, days: null, message: 'Port 8443 is used by another program on this PC.' } }, 'practice'))
      .toEqual(['amber', 'The practice shop is not running. Port 8443 is used by another program on this PC.']);
    expect(light({ ...f, practiceShop: null }, 'practice')).toBeUndefined();
    const inPractice = healthLights({ ...f, practice: true, backups: null, practiceShop: null });
    expect(inPractice.find((l) => l.key === 'backups')?.light).toBe('grey');
    expect(inPractice.some((l) => ['offsite', 'usb', 'drill'].includes(l.key))).toBe(false);
  });
});

describe('the nightly system check', () => {
  it('runs between 01:00 and 05:00 Manila once the last one is 20 hours old, and any time after 36 hours', () => {
    expect(isCheckDue(null, NOW)).toBe(true);
    expect(isCheckDue('2026-09-28T02:00:00.000+08:00', '2026-09-29T02:10:00.000+08:00')).toBe(true);
    expect(isCheckDue('2026-09-28T02:00:00.000+08:00', '2026-09-29T00:30:00.000+08:00')).toBe(false); // 22 h, but before 01:00
    expect(isCheckDue('2026-09-28T02:00:00.000+08:00', '2026-09-28T23:00:00.000+08:00')).toBe(false);
    expect(isCheckDue('2026-09-28T02:00:00.000+08:00', '2026-09-29T14:30:00.000+08:00')).toBe(true); // 36.5 h
    expect(isCheckDue('2026-09-28T20:00:00.000+08:00', '2026-09-29T03:00:00.000+08:00')).toBe(false); // 7 h
  });
});

describe('System Health routes', () => {
  const host: Host = { platform: 'win32', release: '10.0.26100', arch: 'x64', freeBytes: () => 50e9, utcOffsetMinutes: 480 };

  it('lets the owner and the accountant see the lights and run the check, which is stored; not the encoder', async () => {
    const env = await createTestEnv('2026-09-28T02:00:00Z', { host });
    const owner = await env.as('owner');
    const accountant = await env.as('accountant');
    const encoder = await env.as('encoder');
    expect((await encoder.get('/api/system/health')).statusCode).toBe(403);
    expect((await encoder.post('/api/system/health/check')).statusCode).toBe(403);
    expect((await encoder.get('/api/system/support-file')).statusCode).toBe(403);

    const first = (await owner.get('/api/system/health')).json();
    expect(first.overall).toBe('red'); // backups are off until the recovery keys are set
    expect(first.lastCheck).toBeNull();
    expect(first.lights.find((l: { key: string }) => l.key === 'backups')).toMatchObject({ light: 'red', label: 'Backups' });
    expect(first.lights.find((l: { key: string }) => l.key === 'disk')).toMatchObject({ light: 'green', message: '50.0 GB free on the drive with the database.' });

    const checked = await accountant.post('/api/system/health/check');
    expect(checked.statusCode).toBe(200);
    const r = checked.json();
    expect(r.lastCheck).toMatchObject({ at: '2026-09-28T10:00:00.000+08:00', reason: 'button', ok: true });
    expect(r.lights.filter((l: { key: string }) => ['check', 'database', 'books', 'audit'].includes(l.key)).map((l: { light: string }) => l.light)).toEqual(['green', 'green', 'green', 'green']);
    expect(r.details.ledger.map((x: { id: string }) => x.id)).toEqual(['L1', 'L2', 'L3', 'L4', 'L7']);
    expect(env.db.prepare('SELECT reason, user_id AS userId, ok FROM sys_checks').all()).toEqual([{ reason: 'button', userId: accountant.userId, ok: 1 }]);
    expect(() => env.db.prepare('UPDATE sys_checks SET ok = 0').run()).toThrow(/IMMUTABLE/);
    expect((await owner.get('/api/system/health')).json().lastCheck.reason).toBe('button');
  });

  it('gives a support file with the version, lights, migrations and counts, and no names or paths', async () => {
    const env = await createTestEnv('2026-09-28T02:00:00Z', { host });
    createUser(env.db, 'mariaclara', ['encoder']);
    const owner = await env.as('owner');
    const res = await owner.get('/api/system/support-file');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="moonproject-support-2026-09-28.json"');
    const body = res.json();
    expect(body).toMatchObject({ app: 'moonproject', practice: false, os: { platform: 'win32', release: '10.0.26100', arch: 'x64' }, overall: 'red' });
    expect(body.migrations).toContain('engine/0009_system_checks.sql');
    expect(body.counts.activeUsers).toBeGreaterThanOrEqual(2);
    expect(res.body).not.toContain('mariaclara');
  });

  it('in the practice shop reports on the practice database, which is not backed up', async () => {
    const env = await createTestEnv('2026-09-28T02:00:00Z', { practice: true, host });
    const owner = await env.as('owner');
    const r = (await owner.get('/api/system/health')).json();
    expect(r.lights.find((l: { key: string }) => l.key === 'backups').light).toBe('grey');
    expect(r.lights.map((l: { key: string }) => l.key)).not.toContain('offsite');
  });
});
