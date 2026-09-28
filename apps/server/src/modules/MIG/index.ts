import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { migRoutes } from './routes.ts';

export default defineModule({
  code: 'MIG',
  name: 'Migration & Opening',
  permissions: [
    { key: 'mig.run', label: 'Run the migration importer and opening balances', defaultRoles: ['owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: migRoutes,
});
