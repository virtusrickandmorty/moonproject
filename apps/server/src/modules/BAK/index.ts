import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { bakRoutes } from './routes.ts';

export default defineModule({
  code: 'BAK',
  name: 'Backup & Restore',
  permissions: [
    { key: 'bak.view', label: 'See the backup status: when the last backup was made and where copies are', defaultRoles: ['accountant', 'owner'] },
    { key: 'bak.run', label: 'Make a backup now', defaultRoles: ['accountant', 'owner'] },
    { key: 'bak.manage', label: 'Set the backup folders and the two recovery keys', defaultRoles: ['owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: bakRoutes,
});
