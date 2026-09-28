/**
 * ops/windows/update.mjs, the safe update Setup.exe runs (PLAN C8 "Updates"), on a made-up install: a program folder,
 * a data folder with a database, a stand-in for the service wrapper, and a stand-in /api/health that answers with the
 * version of the program folder while the "service" runs. The Windows CI job runs the real thing (smoke.ps1).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SCRIPT = fileURLToPath(new URL('../ops/windows/update.mjs', import.meta.url));
let root: string;
let app: string;
let data: string;
let server: Server;
let healthUrl: string;
const state = () => join(root, 'service-state');
const running = () => readFileSync(state(), 'utf8') === 'running';

/** A program folder as Setup installs it: the app with its @moonproject/shared link, node and the service. */
function install(version: string) {
  mkdirSync(join(app, 'app', 'packages', 'shared'), { recursive: true });
  mkdirSync(join(app, 'app', 'node_modules', '@moonproject'), { recursive: true });
  symlinkSync(join(app, 'app', 'packages', 'shared'), join(app, 'app', 'node_modules', '@moonproject', 'shared'), 'junction');
  writeFileSync(join(app, 'app', 'version.json'), JSON.stringify({ version }));
  writeFileSync(join(app, 'app', `only-in-${version}.ts`), '');
  mkdirSync(join(app, 'node'));
  mkdirSync(join(app, 'service'));
  writeFileSync(join(app, 'VERSION.txt'), `Moonproject ${version}\n`);
}

const version = () => JSON.parse(readFileSync(join(app, 'app', 'version.json'), 'utf8')).version as string;
const auditRows = () => {
  const db = new Database(join(data, 'data', 'moonproject.db'), { readonly: true });
  try {
    return db.prepare('SELECT COUNT(*) FROM audit_log').pluck().get();
  } finally {
    db.close();
  }
};
const record = () => {
  const db = new Database(join(data, 'data', 'moonproject.db'));
  db.prepare("INSERT INTO audit_log (action) VALUES ('document.post')").run();
  db.close();
};

function run(step: 'before' | 'after', ...extra: string[]) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SCRIPT, step, '--app', app, '--data', data, '--service', join(root, 'service.mjs'), '--health', healthUrl, ...extra]);
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('exit', (code) => resolve({ code: code ?? -1, out }));
  });
}
const last = () => JSON.parse(readFileSync(join(data, 'update', 'last-update.json'), 'utf8'));

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'moonproject-update-'));
  app = join(root, 'Program Files', 'Moonproject');
  data = join(root, 'ProgramData', 'Moonproject');
  mkdirSync(join(data, 'data'), { recursive: true });
  const db = new Database(join(data, 'data', 'moonproject.db'));
  db.pragma('journal_mode = WAL');
  db.exec("CREATE TABLE audit_log (seq INTEGER PRIMARY KEY, action TEXT NOT NULL); INSERT INTO audit_log (action) VALUES ('setup'), ('document.post')");
  db.close();
  install('1.0');
  writeFileSync(join(root, 'service.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(state())}, process.argv[2] === 'start' ? 'running' : 'stopped');\n`);
  writeFileSync(state(), 'running');
  // The server answers while the service runs, as the version installed; a "broken" version never answers.
  server = createServer((_req, res) => {
    const v = existsSync(join(app, 'app', 'version.json')) ? version() : null;
    if (!running() || !v || v.startsWith('broken')) return void res.writeHead(503).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, version: v }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  healthUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
});

/** What Setup does: stop the service, run "before", copy the new files, start the service, run "after". */
async function update(to: string, whileStarting?: () => void) {
  writeFileSync(state(), 'stopped');
  const before = await run('before', '--to', to);
  expect(before.code, before.out).toBe(0);
  install(to);
  writeFileSync(state(), 'running');
  whileStarting?.();
  return run('after', '--wait', '2');
}

describe('a safe update (ops/windows/update.mjs)', () => {
  it('copies the database, installs into clean folders and keeps the previous program', async () => {
    const after = await update('2.0');
    expect(after.code, after.out).toBe(0);
    expect(last()).toMatchObject({ result: 'updated', from: '1.0', to: '2.0' });
    expect(readFileSync(join(data, 'update', 'last-update.txt'), 'utf8').split('\r\n')[0]).toBe('updated');
    const copy = new Database(last().copy, { readonly: true });
    expect([copy.pragma('integrity_check', { simple: true }), copy.prepare('SELECT COUNT(*) FROM audit_log').pluck().get()]).toEqual(['ok', 2]);
    copy.close();
    expect(readdirSync(join(app, 'app'))).not.toContain('only-in-1.0.ts'); // a file the new version dropped is gone
    expect(existsSync(join(app, 'previous', 'app', 'only-in-1.0.ts'))).toBe(true);
    expect(existsSync(join(app, 'previous', 'app', 'node_modules', '@moonproject', 'shared'))).toBe(false); // no link into the new version
    expect(existsSync(join(data, 'update', 'pending.json'))).toBe(false);
  });

  it('keeps the newest three copies', async () => {
    for (const v of ['2.0', '3.0', '4.0', '5.0']) expect((await update(v)).code).toBe(0);
    expect(readdirSync(join(data, 'update')).filter((f) => f.endsWith('.db')).map((f) => f.split('-')[2])).toEqual(['3.0', '4.0', '5.0']);
  });

  it('puts the previous version and the database back when the new one does not start and nothing was recorded', async () => {
    const after = await update('broken-2.0');
    expect(after.code).toBe(1);
    expect(last()).toMatchObject({ result: 'rolled-back', from: '1.0', to: 'broken-2.0' });
    expect(last().message).toContain('went back to 1.0. Nothing was lost.');
    expect(version()).toBe('1.0');
    expect(readdirSync(join(app, 'app'))).toContain('only-in-1.0.ts');
    expect(readdirSync(join(app, 'app'))).not.toContain('only-in-broken-2.0.ts');
    expect(readlinkSync(join(app, 'app', 'node_modules', '@moonproject', 'shared'))).toContain(join(app, 'app', 'packages', 'shared'));
    expect(running()).toBe(true);
    expect(auditRows()).toBe(2);
  });

  it('leaves everything as it is when something was recorded after the update began', async () => {
    const after = await update('broken-2.0', record);
    expect(after.code).toBe(1);
    expect(last()).toMatchObject({ result: 'failed', from: '1.0', to: 'broken-2.0' });
    expect(last().message).toContain('was not put back by itself. Nothing was deleted');
    expect(version()).toBe('broken-2.0');
    expect(auditRows()).toBe(3);
    expect(existsSync(last().copy)).toBe(true);
  });

  it('updates a PC with no database yet, and an install from before version.json', async () => {
    rmSync(join(data, 'data'), { recursive: true });
    rmSync(join(app, 'app', 'version.json'));
    const after = await update('2.0');
    expect(after.code, after.out).toBe(0);
    expect(last()).toMatchObject({ result: 'updated', from: '1.0', to: '2.0', copy: null });
  });

  it('does nothing after a first install, and stops before touching anything when the copy fails', async () => {
    expect((await run('after')).out).toContain('No update was in progress');
    writeFileSync(join(data, 'data', 'moonproject.db'), 'not a database');
    const before = await run('before', '--to', '2.0');
    expect(before.code).toBe(1);
    expect(version()).toBe('1.0');
    expect(existsSync(join(app, 'previous', 'app'))).toBe(false);
    expect(readFileSync(join(data, 'logs', 'update.log'), 'utf8')).toContain('before: Stopped:');
  });
});
