/**
 * Local HTTPS (PLAN C6, OWN-13): the app's own certificate authority, and the server certificate it issues for this
 * PC's local addresses. The CA is name-constrained to private addresses and local names, so a phone or PC that trusts
 * it can never be fooled on a public website, even if the CA key leaked. ECDSA P-256 with SHA-256, which every current
 * browser accepts. The CA lasts 10 years; a server certificate 397 days, and it is reissued 30 days before it ends or
 * as soon as the PC's addresses change.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import { bits, bool, explicit, implicit, int, octets, oid, seq, set, time, tlv, utf8 } from './der.ts';

const OID = {
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  organization: '2.5.4.10',
  commonName: '2.5.4.3',
  subjectKeyId: '2.5.29.14',
  keyUsage: '2.5.29.15',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  nameConstraints: '2.5.29.30',
  authorityKeyId: '2.5.29.35',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
};

/** The private IPv4 ranges the CA may certify: loopback, RFC 1918, and the 100.64/10 range VPNs such as NetBird use. */
export const PERMITTED_IPV4: readonly (readonly [string, number])[] = [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10]];
/** The local names the CA may certify, each with every name under it (so any PC's `name.local`). */
export const PERMITTED_DNS: readonly string[] = ['localhost', 'local', 'lan', 'internal', 'home.arpa'];

const DAY = 86_400_000;
const CA_DAYS = 3650;
const SERVER_DAYS = 397;
const RENEW_DAYS = 30;

export interface KeyAndCert { certPem: string; keyPem: string }
export interface Names { ips: string[]; dnsNames: string[] }

const ipBytes = (ip: string) => Buffer.from(ip.split('.').map(Number));
const ipNumber = (ip: string) => ipBytes(ip).readUInt32BE(0);
const inRange = (ip: string, [base, bits]: readonly [string, number]) => bits === 0 || ipNumber(ip) >>> (32 - bits) === ipNumber(base) >>> (32 - bits);
export const permittedIp = (ip: string) => isIPv4(ip) && PERMITTED_IPV4.some((r) => inRange(ip, r));
export const permittedName = (n: string) => PERMITTED_DNS.some((p) => n === p || n.endsWith(`.${p}`));

/** This PC's addresses and names a certificate can cover: its private IPv4 addresses and loopback, localhost, and `<pc name>.local`. */
export function localNames(): Names {
  const ips = new Set(['127.0.0.1']);
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && permittedIp(a.address)) ips.add(a.address);
  const label = hostname().toLowerCase();
  const dnsNames = ['localhost', ...(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ? [`${label}.local`] : [])];
  return { ips: [...ips].sort(), dnsNames };
}

const name = (cn: string) => seq(set(seq(oid(OID.organization), utf8('Virtus Garments, Inc.'))), set(seq(oid(OID.commonName), utf8(cn))));
const extension = (id: string, critical: boolean, value: Buffer) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
/** KeyUsage is a named BIT STRING: DER drops the trailing zero bits. */
const keyUsage = (byte: number) => {
  let unused = 0;
  while (unused < 7 && !((byte >> unused) & 1)) unused++;
  return tlv(0x03, Buffer.from([unused, byte]));
};
const spkiOf = (key: KeyObject) => createPublicKey(key).export({ type: 'spki', format: 'der' });
const keyId = (spki: Buffer) => createHash('sha256').update(spki).digest().subarray(0, 20);
const toPem = (der: Buffer) => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/.{1,64}/g, '$&\n')}-----END CERTIFICATE-----\n`;

function certificate(o: { issuer: Buffer; subject: Buffer; spki: Buffer; notBefore: Date; notAfter: Date; extensions: Buffer[]; signer: KeyObject }): string {
  const algorithm = seq(oid(OID.ecdsaWithSha256));
  const serial = randomBytes(16);
  serial[0] = (serial[0]! & 0x7f) | 0x40; // positive, 16 bytes
  const tbs = seq(explicit(0, int(2)), int(serial), algorithm, o.issuer, seq(time(o.notBefore), time(o.notAfter)), o.subject, o.spki, explicit(3, seq(...o.extensions)));
  const signature = sign('sha256', tbs, { key: o.signer, dsaEncoding: 'der' });
  return toPem(seq(tbs, algorithm, bits(signature)));
}

const newKey = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
const keyPem = (k: KeyObject) => k.export({ type: 'pkcs8', format: 'pem' }).toString();

/** A new CA for this shop, named after the PC it was made on. */
export function createCa(now: Date, pcName = hostname()): KeyAndCert {
  const key = newKey();
  const spki = spkiOf(key);
  const subject = name(`Moonproject local CA (${pcName.slice(0, 40)})`);
  const permitted = [
    ...PERMITTED_IPV4.map(([base, bits]) => seq(implicit(7, Buffer.concat([ipBytes(base), maskBytes(bits)])))),
    ...PERMITTED_DNS.map((d) => seq(implicit(2, Buffer.from(d, 'ascii')))),
  ];
  const certPem = certificate({
    issuer: subject, subject, spki, signer: key,
    notBefore: new Date(now.getTime() - DAY), notAfter: new Date(now.getTime() + CA_DAYS * DAY),
    extensions: [
      extension(OID.basicConstraints, true, seq(bool(true), int(0))),
      extension(OID.keyUsage, true, keyUsage(0x06)), // keyCertSign, cRLSign
      extension(OID.subjectKeyId, false, octets(keyId(spki))),
      extension(OID.nameConstraints, true, seq(tlv(0xa0, ...permitted))),
    ],
  });
  return { certPem, keyPem: keyPem(key) };
}

function maskBytes(bits: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0, 0);
  return b;
}

/**
 * A server certificate for these addresses and names, signed by the CA. Anything the CA's name constraints do not
 * allow is refused here (a browser would refuse the certificate anyway); `unchecked` is for the test that proves it.
 */
export function issueServerCert(ca: KeyAndCert, names: Names, now: Date, unchecked = false): KeyAndCert {
  const bad = [...names.ips.filter((ip) => !permittedIp(ip)), ...names.dnsNames.filter((n) => !permittedName(n))];
  if (bad.length && !unchecked) throw new Error(`Not a local address or name: ${bad.join(', ')}`);
  const caCert = new X509Certificate(ca.certPem);
  const caKey = createPrivateKey(ca.keyPem);
  const key = newKey();
  const spki = spkiOf(key);
  const certPem = certificate({
    issuer: subjectOf(caCert), subject: name('Moonproject server'), spki, signer: caKey,
    notBefore: new Date(now.getTime() - DAY), notAfter: new Date(now.getTime() + SERVER_DAYS * DAY),
    extensions: [
      extension(OID.basicConstraints, true, seq()),
      extension(OID.keyUsage, true, keyUsage(0x80)), // digitalSignature
      extension(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
      extension(OID.subjectAltName, false, seq(...names.dnsNames.map((n) => implicit(2, Buffer.from(n, 'ascii'))), ...names.ips.map((ip) => implicit(7, ipBytes(ip))))),
      extension(OID.subjectKeyId, false, octets(keyId(spki))),
      extension(OID.authorityKeyId, false, seq(implicit(0, keyId(spkiOf(caKey))))),
    ],
  });
  return { certPem, keyPem: keyPem(key) };
}

/** The subject Name of a certificate, as DER, read from the certificate itself so the issuer matches byte for byte. */
function subjectOf(cert: X509Certificate): Buffer {
  const der = cert.raw;
  // Certificate → tbsCertificate → [version, serial, algorithm, issuer, validity, subject, ...]: walk the TLVs.
  const read = (buf: Buffer, at: number) => {
    let len = buf[at + 1]!;
    let head = 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i]!;
      head += n;
    }
    return { start: at, content: at + head, end: at + head + len };
  };
  const tbs = read(der, read(der, 0).content);
  let at = tbs.content;
  for (let i = 0; i < 5; i++) at = read(der, at).end; // skip version, serial, algorithm, issuer, validity
  const subject = read(der, at);
  return der.subarray(subject.start, subject.end);
}

export interface CertInfo { fingerprint256: string; fingerprint1: string; notAfter: string; ips: string[]; dnsNames: string[] }

/** What the screens and the "Join this PC" page show about a certificate. */
export function certInfo(certPem: string): CertInfo {
  const c = new X509Certificate(certPem);
  const alt = (c.subjectAltName ?? '').split(', ').filter(Boolean);
  return {
    fingerprint256: c.fingerprint256,
    fingerprint1: c.fingerprint,
    notAfter: new Date(c.validTo).toISOString(),
    ips: alt.filter((a) => a.startsWith('IP Address:')).map((a) => a.slice('IP Address:'.length)),
    dnsNames: alt.filter((a) => a.startsWith('DNS:')).map((a) => a.slice('DNS:'.length)),
  };
}

/** True when the server certificate misses one of these addresses or names, or ends within 30 days. */
export function needsNewServerCert(certPem: string, want: Names, now: Date): boolean {
  const have = certInfo(certPem);
  return (
    want.ips.some((ip) => !have.ips.includes(ip)) ||
    want.dnsNames.some((n) => !have.dnsNames.includes(n)) ||
    Date.parse(have.notAfter) - now.getTime() < RENEW_DAYS * DAY
  );
}

/** The CA certificate in DER, for the download a phone or PC installs. */
export const caDer = (ca: { certPem: string }) => new X509Certificate(ca.certPem).raw;

