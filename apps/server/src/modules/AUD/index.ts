import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineModule } from '../../engine/documents/registry.ts';
import { audRoutes } from './routes.ts';

export default defineModule({
  code: 'AUD',
  name: 'Audit & Integrity',
  permissions: [
    { key: 'aud.log.view', label: 'View and export the audit log', defaultRoles: ['accountant', 'owner'] },
    { key: 'aud.integrity.view', label: 'Run the integrity checks and see the nightly checks', defaultRoles: ['accountant', 'owner'] },
    { key: 'aud.nightly.run', label: 'Run the nightly checks now (they only read)', defaultRoles: ['owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: audRoutes,
});
