import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { dashRoutes } from './routes.ts';

export default defineModule({
  code: 'DASH',
  name: 'Role homes and notifications',
  permissions: [
    { key: 'dash.view', label: 'View your home and notifications', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'dash.home.owner', label: 'Owner home', defaultRoles: ['owner'] },
    { key: 'dash.home.accountant', label: 'Accountant home', defaultRoles: ['accountant'] },
    { key: 'dash.home.production', label: 'Production home', defaultRoles: ['production'] },
    { key: 'dash.changes.view', label: 'View cancellations and reissues', defaultRoles: ['owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: dashRoutes,
});
