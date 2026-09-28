/**
 * The CA and server certificate kept in the database (migration 0008). `ensureTls` runs at start and every few
 * minutes: it makes the CA once, and a new server certificate when this PC's addresses change or the old one is
 * 30 days from its end. Each new certificate is audited.
 */
import type { Db } from '../../../platform/db/driver.ts';
import { stamp, type Clock } from '../../../platform/clock.ts';
import { appendAudit } from '../../audit.ts';
import { certInfo, createCa, issueServerCert, needsNewServerCert, type CertInfo, type KeyAndCert, type Names } from './certs.ts';

export type Stored = KeyAndCert & CertInfo;

function latest(db: Db, kind: 'ca' | 'server'): Stored | undefined {
  const r = db.prepare('SELECT cert_pem AS certPem, key_pem AS keyPem FROM tls_certificates WHERE kind = ? ORDER BY id DESC LIMIT 1').get(kind) as KeyAndCert | undefined;
  return r && { ...r, ...certInfo(r.certPem) };
}

function save(db: Db, clock: Clock, kind: 'ca' | 'server', c: KeyAndCert): Stored {
  const info = certInfo(c.certPem);
  const at = stamp(clock);
  db.transaction(() => {
    db.prepare('INSERT INTO tls_certificates (kind, cert_pem, key_pem, fingerprint256, not_after, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, c.certPem, c.keyPem, info.fingerprint256, info.notAfter, at);
    appendAudit(db, {
      at, userId: null, action: kind === 'ca' ? 'tls.ca_created' : 'tls.server_cert_issued', entityType: 'tls_certificate',
      data: { fingerprint256: info.fingerprint256, notAfter: info.notAfter, ips: info.ips, dnsNames: info.dnsNames },
    });
  })();
  return { ...c, ...info };
}

/** The CA (made the first time) and a server certificate covering `want`. `issued` is true when a new one was made. */
export function ensureTls(db: Db, clock: Clock, want: Names): { ca: Stored; server: Stored; issued: boolean } {
  const ca = latest(db, 'ca') ?? save(db, clock, 'ca', createCa(clock.now()));
  const current = latest(db, 'server');
  if (current && !needsNewServerCert(current.certPem, want, clock.now())) return { ca, server: current, issued: false };
  // Keep covering an address the old certificate had, in case this PC has it back (a VPN that was down).
  const names = current ? { ips: [...new Set([...want.ips, ...current.ips])].slice(0, 16).sort(), dnsNames: [...new Set([...want.dnsNames, ...current.dnsNames])].slice(0, 8) } : want;
  return { ca, server: save(db, clock, 'server', issueServerCert(ca, names, clock.now())), issued: true };
}

/** The CA as the screens show it, or null before the first start in LAN mode. */
export function currentCa(db: Db): CertInfo | null {
  const ca = latest(db, 'ca');
  return ca ? certInfo(ca.certPem) : null;
}

/** The CA certificate (public part only), for the "Join this PC" download. */
export function caCertPem(db: Db): string | null {
  return (db.prepare("SELECT cert_pem FROM tls_certificates WHERE kind = 'ca'").pluck().get() as string | undefined) ?? null;
}
