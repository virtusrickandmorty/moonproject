import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { countDoc } from './doctypes/count.ts';
import { invRoutes } from './routes.ts';

export default defineModule({
  code: 'INV',
  name: 'Inventory (periodic)',
  permissions: [
    { key: 'inv.count.view', label: 'View inventory counts and print count sheets', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'inv.count.create', label: 'Prepare inventory counts', defaultRoles: ['encoder', 'accountant', 'owner'] },
    // The count adjusts the books (1301/1302 against 5109), so recording and cancelling are the accountant's and the owners'.
    { key: 'inv.count.post', label: 'Record inventory counts', defaultRoles: ['accountant', 'owner'] },
    { key: 'inv.count.cancel', label: 'Cancel or edit recorded inventory counts', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [countDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: invRoutes,
});
