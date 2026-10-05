import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { supRoutes } from './routes.ts';

export default defineModule({
  code: 'SUP',
  name: 'Customer support',
  permissions: [
    { key: 'sup.view', label: 'Read messages sent from the support page', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'sup.manage', label: 'Answer support messages: notes and status', defaultRoles: ['encoder', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: supRoutes,
});
