/**
 * ops/windows/watchdog.mjs, the scheduled task that restarts Moonproject when it stops answering (PLAN C8), on a
 * made-up install: a stand-in for the service wrapper and a stand-in /api/health that answers while the "service"
 * runs. The Windows CI job runs the real task (smoke.ps1).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../ops/windows/watchdog.mjs', import.meta.url));
let root: string;
let data: string;
let server: Server;
let healthUrl: string;
const state = () => join(root, 'service-state');
const running = () => readFileSync(state(), 'utf8') === 'running';
const logged = () => (existsSync(join(data, 'logs', 'watchdog.log')) ? readFileSync(join(data, 'logs', 'watchdog.log'), 'utf8').trim().split('\n') : []);

function check() {
  return new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, 'check', '--app', join(root, 'app'), '--data', data, '--service', join(root, 'service.mjs'), '--health', healthUrl, '--timeout', '2']);
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('exit', (code) => resolve({ code: code ?? -1, out }));
  });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'moonproject-watchdog-'));
  data = join(root, 'ProgramData', 'Moonproject');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(root, 'service.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(state())}, process.argv[2] === 'start' ? 'running' : 'stopped');\n`);
  writeFileSync(state(), 'running');
  server = createServer((_req, res) => {
    if (!running()) return void res.writeHead(503).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  healthUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
});

describe('the watchdog', () => {
  it('leaves a server that answers alone', async () => {
    for (let i = 0; i < 3; i++) expect((await check()).code).toBe(0);
    expect([running(), logged()]).toEqual([true, []]);
  });

  it('restarts the service when it has not answered twice in a row, and logs the restart', async () => {
    writeFileSync(state(), 'stopped'); // stopped by force: Windows does not start it again by itself
    expect((await check()).code).toBe(0);
    expect([running(), logged()]).toEqual([false, []]); // once may be a slow moment
    const r = await check();
    expect(r.code, r.out).toBe(0);
    expect(running()).toBe(true);
    expect(logged()).toEqual([expect.stringMatching(/No answer from .* twice in a row \(the service was stopped\): restarted the Moonproject service$/)]);
    // Answering again: the count starts over.
    await check();
    writeFileSync(state(), 'stopped');
    await check();
    expect(running()).toBe(false);
  });

  it('counts a miss from long ago as a first one', async () => {
    mkdirSync(join(data, 'logs'), { recursive: true });
    writeFileSync(join(data, 'logs', 'watchdog-state.json'), JSON.stringify({ misses: 1, at: new Date(Date.now() - 20 * 60_000).toISOString() }));
    writeFileSync(state(), 'stopped');
    await check();
    expect(running()).toBe(false);
  });

  it('leaves the service alone while an update runs', async () => {
    mkdirSync(join(data, 'update'), { recursive: true });
    writeFileSync(join(data, 'update', 'pending.json'), '{}');
    writeFileSync(state(), 'stopped');
    for (let i = 0; i < 3; i++) await check();
    expect([running(), logged()]).toEqual([false, []]);
  });
});
