import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { szrRoutes } from './routes.ts';

export default defineModule({
  code: 'SZR',
  name: 'Sizer Tracker',
  permissions: [
    { key: 'szr.set.view', label: 'View sizer sets', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'szr.set.edit', label: 'Edit sizer sets', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'szr.loan.view', label: 'View sizer loans', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'szr.loan.edit', label: 'Edit sizer loans', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: szrRoutes,
});
