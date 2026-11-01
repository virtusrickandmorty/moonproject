import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { olkRoutes } from './routes.ts';

// Order links (the owner's request, Nov 2026): a private link the customer fills in (a team list, or a group order where
// each member gives their own pieces) before the job order is made.
export default defineModule({
  code: 'OLK',
  name: 'Order links',
  permissions: [
    { key: 'olk.view', label: 'See order links and what customers filled in', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'olk.manage', label: 'Make, change and close order links', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: olkRoutes,
});
