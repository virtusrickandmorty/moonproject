import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { rateRoutes } from './routes.ts';

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
