import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { prfRoutes } from './routes.ts';

// Design proofs (the owner's request, Nov 2026): the customer approves a job order's design, or asks for a change, on a
// private link instead of on Messenger; staff see the answer on the job order and in the bell.
export default defineModule({
  code: 'PRF',
  name: 'Design proofs',
  permissions: [
    { key: 'prf.view', label: 'See the design proofs sent on job orders and the customers\' answers', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'prf.manage', label: 'Send design proofs to customers', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: prfRoutes,
});
