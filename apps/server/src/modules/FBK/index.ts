import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { fbkRoutes } from './routes.ts';

// Customer ratings (the owner's request, Nov 2026): after a job order is released, the customer rates it on a private link;
// staff see every rating, and a low one in the bell.
export default defineModule({
  code: 'FBK',
  name: 'Customer ratings',
  permissions: [
    { key: 'fbk.view', label: 'See customers\' ratings of their orders', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'fbk.ask', label: 'Make the link that asks a customer to rate an order', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: fbkRoutes,
});
