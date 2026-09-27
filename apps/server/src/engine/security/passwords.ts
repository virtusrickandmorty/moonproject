/**
 * scrypt password hashing (PLAN C6): N=2^17, r=8, p=1, per-user salt, parameters stored in the hash.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppError } from '@moonproject/shared';

export const DEFAULT_SCRYPT_N = 2 ** 17;

export function hashPassword(password: string, n = DEFAULT_SCRYPT_N): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, 32, { N: n, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${n}$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  return timingSafeEqual(expected, actual);
}

/** Passphrases of 15+ characters, e.g. three or four words (OWN-14 default). No forced expiry. */
export function checkPasswordPolicy(password: unknown, username?: string): string {
  if (typeof password !== 'string' || [...password].length < 15) {
    throw new AppError('WEAK_PASSWORD', 'Use a passphrase of at least 15 characters, for example three or four words.', 400);
  }
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    throw new AppError('WEAK_PASSWORD', 'The passphrase must not contain your username.', 400);
  }
  return password;
}
