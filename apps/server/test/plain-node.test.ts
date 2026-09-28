/**
 * The Windows service runs the server source on plain Node, which strips the types itself (PLAN C6): no tsx, no build.
 * Node refuses TypeScript it cannot simply erase (parameter properties, enums, namespaces), and nothing else here would
 * notice, because the other tests run through vitest's own compiler. So this starts main.ts the way the service does.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReadonly } from '../src/platform/db/driver.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
let dir: string;
const running: ChildProcess[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'moonproject-node-'));
});

afterAll(() => {
  for (const child of running) child.kill();
  rmSync(dir, { recursive: true, force: true });
});

/** Starts main.ts on plain Node and waits until every `wanted` log message has shown, returning their port numbers. */
function start(name: string, env: Record<string, string>, wanted: RegExp[]): Promise<number[]> {
  const { NODE_OPTIONS: _, ...parent } = process.env;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN], {
    env: { ...parent, MOONPROJECT_DB: join(dir, name, 'moonproject.db'), MOONPROJECT_BACKUP_DIR: join(dir, name, 'backups'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push(child);
  return new Promise((resolve, reject) => {
    let output = '';
    const ports: (number | undefined)[] = wanted.map(() => undefined);
    const read = (chunk: Buffer) => {
      output += chunk;
      wanted.forEach((re, i) => (ports[i] ??= Number(output.match(re)?.[1]) || undefined));
      if (ports.every((p) => p !== undefined)) resolve(ports as number[]);
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    child.on('exit', (code) => reject(new Error(`main.ts stopped (${code}):\n${output}`)));
  });
}

const fetchBytes = (url: string, ca?: string) =>
  new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
    const done = (res: import('node:http').IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks) }));
    };
    (ca ? httpsGet(url, { ca }, done) : httpGet(url, done)).on('error', reject);
  });

describe('the server on plain Node', () => {
  it('starts for development on this PC only', async () => {
    const [port] = await start('dev', { PORT: '0' }, [/Server listening at http:\/\/127\.0\.0\.1:(\d+)/]);
    const res = await fetchBytes(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.toString())).toMatchObject({ ok: true });
  }, 60_000);

  it('starts in LAN mode: HTTPS through the shop CA, and the "Join this PC" page', async () => {
    const [https, http] = await start('lan', { MOONPROJECT_LISTEN: 'lan', HTTPS_PORT: '0', HTTP_PORT: '0' }, [
      /Server listening at https:\/\/[\d.]+:(\d+)/,
      /Join this PC\\?" page on port (\d+)/, // pino writes the message as JSON, so the quote comes escaped
    ]);
    const db = openReadonly(join(dir, 'lan', 'moonproject.db'));
    const { cert_pem: ca } = db.prepare("SELECT cert_pem FROM tls_certificates WHERE kind = 'ca'").get() as { cert_pem: string };
    db.close();
    const health = await fetchBytes(`https://127.0.0.1:${https}/api/health`, ca);
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body.toString())).toMatchObject({ ok: true });
    const page = await fetchBytes(`http://127.0.0.1:${http}/`);
    expect(page.body.toString()).toContain('Join this PC to Moonproject');
    expect((await fetchBytes(`http://127.0.0.1:${http}/moonproject-ca.crt`)).body.equals(new X509Certificate(ca).raw)).toBe(true);
  }, 60_000);
});
