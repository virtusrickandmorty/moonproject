import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { prtRoutes } from './routes.ts';

export default defineModule({
  code: 'PRT',
  name: 'Printing & Company Profile',
  permissions: [
    { key: 'prt.profile.view', label: 'View company print details', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'prt.profile.manage', label: 'Edit company print details', defaultRoles: ['owner'] },
    { key: 'prt.test_pack', label: 'Use the printer test pack', defaultRoles: ['owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: prtRoutes,
});
