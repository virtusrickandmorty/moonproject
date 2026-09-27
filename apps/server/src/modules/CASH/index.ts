import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { transferDoc } from './doctypes/transfer.ts';
import { cashRoutes } from './routes.ts';

export default defineModule({
  code: 'CASH',
  name: 'Cash & Banks',
  permissions: [
    { key: 'cash.places.view', label: 'See the list of cash places', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.balances.view_all', label: 'See the balance of every cash place', defaultRoles: ['accountant', 'owner'] },
    { key: 'cash.trf.view', label: 'View fund transfers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.trf.create', label: 'Prepare fund transfers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.trf.post', label: 'Record fund transfers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.trf.cancel', label: 'Cancel or edit recorded fund transfers', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [transferDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: cashRoutes,
});
