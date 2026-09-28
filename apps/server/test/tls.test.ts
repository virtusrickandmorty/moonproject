/**
 * Local HTTPS (PLAN C6, OWN-13): the shop's own CA, name-constrained to private addresses and local names; the server
 * certificate it issues; a real TLS handshake trusting only that CA (and refusing a certificate outside the
 * constraints); the certificates kept in the database and renewed; the "Join this PC" page over plain HTTP.
 */
import { X509Certificate } from 'node:crypto';
import { createServer as createHttp, type Server } from 'node:http';
import { createServer as createHttps, get as httpsGet } from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv } from './helpers.ts';
import { int, oid, time } from '../src/engine/security/tls/der.ts';
import { createCa, issueServerCert, needsNewServerCert, permittedIp, permittedName, type KeyAndCert } from '../src/engine/security/tls/certs.ts';
import { CA_FILE, joinHandler, requestHost } from '../src/engine/security/tls/join.ts';
import { ensureTls } from '../src/engine/security/tls/store.ts';

const NOW = new Date('2026-09-28T02:00:00Z');
const names = { ips: ['127.0.0.1', '192.168.1.20', '100.80.1.2'], dnsNames: ['localhost', 'virtus-pc.local'] };
const DAY = 86_400_000;

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));
const listen = async (s: Server) => {
  servers.push(s);
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return (s.address() as AddressInfo).port;
};

/** GET https://127.0.0.1:<port>/ trusting only `caPem`: 'OK' or the TLS error. */
async function handshake(cert: KeyAndCert, caPem: string, skipHostCheck = false): Promise<string> {
  const port = await listen(createHttps({ key: cert.keyPem, cert: cert.certPem }, (_req, res) => res.end('OK')));
  return new Promise((ok) => {
    httpsGet({ host: '127.0.0.1', port, ca: caPem, ...(skipHostCheck ? { checkServerIdentity: () => undefined } : {}) }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => ok(body));
    }).on('error', (e) => ok(`ERROR ${e.message}`));
  });
}

describe('DER writer', () => {
  it('encodes integers, object ids and times as X.509 needs', () => {
    expect([int(2).toString('hex'), int(128).toString('hex'), int(Buffer.from([0, 0, 5])).toString('hex')]).toEqual(['020102', '02020080', '020105']);
    expect(oid('1.2.840.10045.4.3.2').toString('hex')).toBe('06082a8648ce3d040302');
    expect(time(new Date('2036-09-25T05:00:00Z')).toString('ascii', 2)).toBe('360925050000Z'); // UTCTime
    expect(time(new Date('2050-01-01T00:00:00Z')).toString('ascii', 2)).toBe('20500101000000Z'); // GeneralizedTime
  });
});

describe('the shop CA and the server certificate', () => {
  const ca = createCa(NOW, 'VIRTUS-PC');

  it('makes a 10-year CA that may sign server certificates only (path length 0)', () => {
    const x = new X509Certificate(ca.certPem);
    expect([x.ca, x.verify(x.publicKey), x.subject.includes('Moonproject local CA (VIRTUS-PC)')]).toEqual([true, true, true]);
    expect(Math.round((Date.parse(x.validTo) - NOW.getTime()) / DAY)).toBe(3650);
  });

  it('issues a 397-day server certificate for this PC’s local addresses and names, signed by the CA', () => {
    const x = new X509Certificate(issueServerCert(ca, names, NOW).certPem);
    const c = new X509Certificate(ca.certPem);
    expect([x.ca, x.verify(c.publicKey), x.checkIssued(c), x.keyUsage]).toEqual([false, true, true, ['1.3.6.1.5.5.7.3.1']]);
    expect([x.checkIP('192.168.1.20'), x.checkIP('100.80.1.2'), x.checkHost('virtus-pc.local'), x.checkHost('localhost')]).toEqual(['192.168.1.20', '100.80.1.2', 'virtus-pc.local', 'localhost']);
    expect(Math.round((Date.parse(x.validTo) - NOW.getTime()) / DAY)).toBe(397);
  });

  it('only covers private addresses and local names', () => {
    expect(['127.0.0.1', '10.1.2.3', '172.31.0.9', '192.168.0.5', '100.127.255.1'].map(permittedIp)).toEqual([true, true, true, true, true]);
    expect(['8.8.8.8', '172.32.0.1', '100.128.0.1', '169.254.1.1'].map(permittedIp)).toEqual([false, false, false, false]);
    expect(['localhost', 'virtus-pc.local', 'pc.home.arpa', 'google.com', 'local.example.com'].map(permittedName)).toEqual([true, true, true, false, false]);
    expect(() => issueServerCert(ca, { ips: ['8.8.8.8'], dnsNames: [] }, NOW)).toThrow('Not a local address or name: 8.8.8.8');
  });

  it('a browser trusting only the shop CA connects; a certificate outside the CA’s constraints is refused', async () => {
    expect(await handshake(issueServerCert(ca, names, NOW), ca.certPem)).toBe('OK');
    // Even with the host check off, the CA's name constraints stop a certificate for a public site.
    const outside = issueServerCert(ca, { ips: ['8.8.8.8'], dnsNames: ['www.google.com'] }, NOW, true);
    expect(await handshake(outside, ca.certPem, true)).toMatch(/subtree/i);
    // And another CA's certificate is not trusted.
    const other = createCa(NOW, 'OTHER-PC');
    expect(await handshake(issueServerCert(other, names, NOW), ca.certPem)).toMatch(/^ERROR /);
  });

  it('asks for a new server certificate for a new address, or 30 days before the end', () => {
    const cert = issueServerCert(ca, names, NOW).certPem;
    expect(needsNewServerCert(cert, names, NOW)).toBe(false);
    expect(needsNewServerCert(cert, { ...names, ips: [...names.ips, '192.168.1.21'] }, NOW)).toBe(true);
    expect(needsNewServerCert(cert, names, new Date(NOW.getTime() + 366 * DAY))).toBe(false);
    expect(needsNewServerCert(cert, names, new Date(NOW.getTime() + 368 * DAY))).toBe(true);
  });
});

describe('certificates kept in the database', () => {
  it('makes the CA once, reissues the server certificate when the addresses change or it nears its end, and audits each', async () => {
    const env = await createTestEnv();
    const owner = await env.as('owner');
    expect((await owner.get('/api/system/tls')).json()).toEqual({ ca: null });

    const first = ensureTls(env.db, env.clock, names);
    expect(first.issued).toBe(true);
    expect(ensureTls(env.db, env.clock, names).issued).toBe(false);

    // The VPN goes down and the PC gets a new LAN address: the old addresses stay covered, the CA stays the same.
    const moved = ensureTls(env.db, env.clock, { ips: ['127.0.0.1', '192.168.1.21'], dnsNames: ['localhost'] });
    expect([moved.issued, moved.ca.fingerprint256, moved.server.ips]).toEqual([true, first.ca.fingerprint256, ['100.80.1.2', '127.0.0.1', '192.168.1.20', '192.168.1.21']]);

    env.clock.set('2027-09-25T02:00:00Z'); // 32 days before the end
    expect(ensureTls(env.db, env.clock, names).issued).toBe(false);
    env.clock.set('2027-10-01T02:00:00Z');
    const renewed = ensureTls(env.db, env.clock, names);
    expect([renewed.issued, renewed.ca.fingerprint256]).toEqual([true, first.ca.fingerprint256]);

    const kinds = env.db.prepare('SELECT kind FROM tls_certificates ORDER BY id').pluck().all();
    expect(kinds).toEqual(['ca', 'server', 'server', 'server']);
    expect(env.db.prepare("SELECT action FROM audit_log WHERE entity_type = 'tls_certificate' ORDER BY seq").pluck().all())
      .toEqual(['tls.ca_created', 'tls.server_cert_issued', 'tls.server_cert_issued', 'tls.server_cert_issued']);
    expect(() => env.db.prepare("UPDATE tls_certificates SET key_pem = 'x'").run()).toThrow('IMMUTABLE');

    env.clock.set('2027-10-01T03:00:00Z');
    const signedIn = await env.as('encoder');
    expect((await signedIn.get('/api/system/tls')).json().ca.fingerprint256).toBe(first.ca.fingerprint256);
  });
});

describe('the "Join this PC" page (plain HTTP)', () => {
  const ca = createCa(NOW, 'VIRTUS-PC');
  const fingerprint = new X509Certificate(ca.certPem).fingerprint256;
  const start = () => listen(createHttp(joinHandler({ caPem: () => ca.certPem, httpsPort: 8443, fallbackHost: () => '192.168.1.20' })));
  const get = (port: number, path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', ...init });

  it('shows the CA code and the steps, offers the CA download, and redirects everything else to HTTPS', async () => {
    const port = await start();
    const page = await get(port, '/');
    const html = await page.text();
    expect([page.status, html.includes(fingerprint), html.includes('This is the server PC'), html.includes(`https://127.0.0.1:8443/`)]).toEqual([200, true, true, true]);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");

    const file = await get(port, CA_FILE);
    expect([file.status, file.headers.get('content-type')]).toEqual([200, 'application/x-x509-ca-cert']);
    expect(new X509Certificate(Buffer.from(await file.arrayBuffer())).fingerprint256).toBe(fingerprint);

    const other = await get(port, '/api/health?x=1');
    expect([other.status, other.headers.get('location')]).toEqual([301, 'https://127.0.0.1:8443/api/health?x=1']);
    expect((await get(port, '/', { method: 'POST' })).status).toBe(405);
  });

  it('never reflects an odd Host header', () => {
    expect([requestHost('192.168.1.20:80'), requestHost('Virtus-PC.local'), requestHost('<script>'), requestHost('[::1]:80'), requestHost(undefined)])
      .toEqual(['192.168.1.20', 'virtus-pc.local', null, null, null]);
  });
});
