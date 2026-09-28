/**
 * The repository must check out on the shop's Windows PC and the Windows release job (PLAN C1, C2). Git for Windows
 * refuses a path with a reserved device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9, with or without an extension),
 * a character Windows forbids, or a name ending in a dot or space; and two paths that differ only in case collide.
 */
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo', '.vite']);

function paths(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? [relative(root, p), ...paths(p)] : [relative(root, p)];
  });
}

const reserved = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const badName = (name: string) => reserved.test(name.split('.')[0]!) || /[<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name);

describe('repository paths work on Windows', () => {
  const all = paths(root);

  it('no file or folder has a reserved or invalid Windows name', () => {
    expect(all.filter((p) => p.split(/[\\/]/).some(badName))).toEqual([]);
  });

  it('no two paths differ only in upper and lower case', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const p of all) {
      const k = p.toLowerCase();
      if (seen.has(k)) clashes.push(`${seen.get(k)} / ${p}`);
      else seen.set(k, p);
    }
    expect(clashes).toEqual([]);
  });

  it('the checks catch the names that broke #34', () => {
    expect(['PRN', 'prn.ts', 'Aux.tsx', 'COM1', 'lpt9.md', 'a:b', 'name.'].every(badName)).toBe(true);
    expect(['PRT', 'print.ts', 'COM', 'console.ts', 'auxiliary.ts', 'null.ts'].some(badName)).toBe(false);
  });
});
