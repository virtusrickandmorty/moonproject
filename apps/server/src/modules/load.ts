/**
 * Modules self-register: every modules/<CODE>/index.ts default-exports defineModule(...) (PLAN C3).
 * There is no central list to edit.
 */
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ModuleDef } from '../engine/documents/registry.ts';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadModules(dir = here): Promise<ModuleDef[]> {
  const out: ModuleDef[] = [];
  for (const code of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const file = join(dir, code, 'index.ts');
    if (!existsSync(file)) continue;
    const mod = (await import(pathToFileURL(file).href)) as { default?: ModuleDef };
    if (!mod.default) throw new Error(`modules/${code}/index.ts must default-export defineModule(...)`);
    if (mod.default.code !== code) throw new Error(`modules/${code} declares code ${mod.default.code}`);
    out.push(mod.default);
  }
  return out;
}
