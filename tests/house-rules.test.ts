/**
 * Repository rules from AGENTS.md, checked on every PR.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DOC_TITLES } from '../apps/server/src/engine/documents/registry.ts';
import { loadModules } from '../apps/server/src/modules/load.ts';

const ROOT = join(import.meta.dirname, '..');

function files(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'dist') return [];
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(f) ? [p] : [];
  });
}

const sources = [...files(join(ROOT, 'apps'), /\.(ts|tsx)$/), ...files(join(ROOT, 'packages'), /\.(ts|tsx)$/)];

describe('house rules', () => {
  it('never takes a business date from the UTC clock (NR-7)', () => {
    const bad = sources.filter((f) => /toISOString\(\)\s*\.\s*(slice|substring|substr)\(\s*0\s*,\s*10\s*\)/.test(readFileSync(f, 'utf8')));
    expect(bad.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('module tables are prefixed with the module code (PLAN C3)', async () => {
    const problems: string[] = [];
    for (const dir of files(join(ROOT, 'apps/server/src/modules'), /\.sql$/)) {
      const code = relative(join(ROOT, 'apps/server/src/modules'), dir).split(/[\\/]/)[0]!.toLowerCase();
      for (const m of readFileSync(dir, 'utf8').matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+)/gi)) {
        if (!m[1]!.startsWith(`${code}_`)) problems.push(`${relative(ROOT, dir)}: ${m[1]}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('no document is titled Invoice, Sales Invoice or Official Receipt (NR-14)', () => {
    for (const t of DOC_TITLES) {
      expect(t).not.toMatch(/official receipt/i);
      expect(t).not.toMatch(/^(sales )?invoice$/i);
    }
  });

  it('every document type is complete and has a property-test generator', async () => {
    for (const m of await loadModules()) {
      for (const d of m.docTypes) {
        expect(typeof d.arbitrary, d.key).toBe('function');
        expect(DOC_TITLES).toContain(d.title);
        // Strict schemas reject unknown keys such as date or totalCents (NR-6).
        const probe = d.inputSchema.safeParse({ __unknown__: 1 });
        expect(probe.success, `${d.key} input schema must be .strict()`).toBe(false);
      }
    }
  });

  it('posting rules live only in module doctypes the Claude lanes own (money rule, PLAN J1)', () => {
    // A cheap tripwire: journal lines are only built in modules/*/doctypes and the engine.
    const offenders = sources.filter((f) => {
      const rel = relative(ROOT, f).replace(/\\/g, '/');
      if (/apps\/server\/src\/(engine|modules\/[A-Z0-9]+\/doctypes)\//.test(rel) || /\.test\.ts$/.test(rel)) return false;
      return /\bdebitCents\s*:/.test(readFileSync(f, 'utf8'));
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
