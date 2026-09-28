/**
 * The little DER (ASN.1) writer the local certificates need (PLAN C6): Node signs and parses X.509 but cannot build a
 * certificate, and a few dozen lines here avoid a dependency that would sit next to the CA's private key.
 * Only what RFC 5280 certificates use: SEQUENCE, SET, INTEGER, OID, strings, times, and context-specific tags.
 */

function header(tag: number, length: number): Buffer {
  if (length < 0x80) return Buffer.from([tag, length]);
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
  return Buffer.from([tag, 0x80 | bytes.length, ...bytes]);
}

/** One TLV: the tag byte, the DER length and the contents. */
export const tlv = (tag: number, ...content: Buffer[]): Buffer => {
  const body = Buffer.concat(content);
  return Buffer.concat([header(tag, body.length), body]);
};

export const seq = (...items: Buffer[]) => tlv(0x30, ...items);
export const set = (...items: Buffer[]) => tlv(0x31, ...items);
export const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
export const octets = (b: Buffer) => tlv(0x04, b);
/** A BIT STRING with no unused bits. */
export const bits = (b: Buffer) => tlv(0x03, Buffer.from([0]), b);
export const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));

/** A non-negative INTEGER from a number or big-endian bytes (a leading zero is added when the top bit is set). */
export function int(v: number | Buffer): Buffer {
  const hex = typeof v === 'number' ? v.toString(16) : '';
  let b = typeof v === 'number' ? Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex') : v;
  while (b.length > 1 && b[0] === 0 && b[1]! < 0x80) b = b.subarray(1);
  return tlv(0x02, b[0]! >= 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
}

export function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number) as [number, number, ...number[]];
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk: number[] = [n & 0x7f];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift(0x80 | (v & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

/** UTCTime up to 2049, GeneralizedTime from 2050 (RFC 5280 §4.1.2.5), always in UTC to the second. */
export function time(d: Date): Buffer {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'; // YYYYMMDDHHMMSSZ
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2), 'ascii')) : tlv(0x18, Buffer.from(iso, 'ascii'));
}

/** [n] EXPLICIT: a constructed context tag around one element. */
export const explicit = (n: number, inner: Buffer) => tlv(0xa0 | n, inner);
/** [n] IMPLICIT primitive, like dNSName [2] or iPAddress [7] in a GeneralName. */
export const implicit = (n: number, content: Buffer) => tlv(0x80 | n, content);
