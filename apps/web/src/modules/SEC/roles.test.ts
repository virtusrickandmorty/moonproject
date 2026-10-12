/** Admin › Roles and permissions: every module's permissions are under a plain name (the owner's report, Oct 2026). */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { MODULE_NAMES, moduleName } from './roles.ts';

it('names every module the server has, so no permission group shows a bare code', () => {
  const dir = join(__dirname, '../../../../server/src/modules');
  const codes = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'index.ts'))).map((d) => d.name);
  expect(codes.length).toBeGreaterThan(30);
  expect(codes.filter((c) => !(c in MODULE_NAMES))).toEqual([]);
  expect([moduleName('ALT'), moduleName('TPL'), moduleName('alt')]).toEqual(['Alterations & replacements', 'TPL services (client stock)', 'Alterations & replacements']);
});
