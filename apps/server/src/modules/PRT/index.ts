import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { prnRoutes } from './routes.ts';

export default defineModule({
  code: 'PRN',
  name: 'Printing & Company Profile',
  permissions: [
    { key: 'prn.profile.view', label: 'View company print details', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'prn.profile.manage', label: 'Edit company print details', defaultRoles: ['owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: prnRoutes,
});
