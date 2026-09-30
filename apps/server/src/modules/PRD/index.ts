import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { entryDoc } from './doctypes/entry.ts';
import { prdRoutes } from './routes.ts';

export default defineModule({
  code: 'PRD',
  name: 'Production',
  permissions: [
    { key: 'prd.view', label: 'View the production board and production entries', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'prd.tv', label: 'View the read-only TV production board', defaultRoles: ['production', 'accountant', 'owner'] },
    { key: 'prd.assign', label: 'Record and cancel workers’ pieces (production entries)', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'prd.progress', label: 'Set a line’s route, and mark steps completed, not needed or reopened', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'prd.steps', label: 'Rename production steps and switch them on or off', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [entryDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: prdRoutes,
});
