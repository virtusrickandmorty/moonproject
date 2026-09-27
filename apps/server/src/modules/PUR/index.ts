import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { purRoutes } from './routes.ts';

export default defineModule({
  code: 'PUR',
  name: 'Suppliers & Purchasing',
  permissions: [
    { key: 'pur.supplier.view', label: 'View suppliers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'pur.supplier.edit', label: 'Edit suppliers', defaultRoles: ['accountant', 'owner'] },
    { key: 'pur.supply.view', label: 'View supplies', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'pur.supply.edit', label: 'Edit supplies', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: purRoutes,
});
