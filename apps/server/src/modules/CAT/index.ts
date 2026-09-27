import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { catRoutes } from './routes.ts';

export default defineModule({
  code: 'CAT',
  name: 'Catalog & Pricing',
  permissions: [
    { key: 'cat.view', label: 'View catalog items and prices', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'cat.manage', label: 'Create and edit catalog items', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cat.price.manage', label: 'Set effective-dated catalog prices', defaultRoles: ['accountant', 'owner'] },
    { key: 'cat.price.override', label: 'Override a catalog price on a sales line', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: catRoutes,
});
