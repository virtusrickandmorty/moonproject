import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { rateRoutes } from './routes.ts';
import { onFirstOwner } from '../../engine/security/first-owner.ts';
import { switchOffStarters } from './rates.ts';

// A new shop set up from the first-run screen starts with nothing in its price list (the owner's request, Oct 2026): the
// made-up starter rates (RATE 0001, OWN-05) are switched off, with a reason; never deleted.
onFirstOwner((db, owner) => { if (owner.freshPriceList) switchOffStarters(db, owner); });

export default defineModule({
  code: 'RATE',
  name: 'Piece-Rate Table',
  permissions: [
    { key: 'rate.view', label: 'View piece rates', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'rate.manage', label: 'Set new piece rates', defaultRoles: ['accountant', 'owner'] },
    { key: 'rate.override', label: 'Type a different piece rate on a production entry, with a reason', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: rateRoutes,
});
