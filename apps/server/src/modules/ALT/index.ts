/**
 * Alterations and replacements (the owner's request, Oct 2026): items customers bring back to be altered or replaced.
 * Received by staff, decided by the owner or the accountant (free, a fee, or declined), made on the production board as a
 * job order for the customer, and given back on a release slip. See alt.ts.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { altRoutes } from './routes.ts';

export default defineModule({
  code: 'ALT',
  name: 'Alterations and replacements',
  permissions: [
    { key: 'alt.view', label: 'See items brought back for alteration or replacement', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'alt.receive', label: 'Receive items brought back for alteration or replacement', defaultRoles: ['encoder', 'accountant', 'owner'] },
    // Accepting makes the job order, so it also needs jo.post.
    { key: 'alt.decide', label: 'Open and decide returns awaiting a decision: free, a fee, or declined (then it goes to production)', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: altRoutes,
});
