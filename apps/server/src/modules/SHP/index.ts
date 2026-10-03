import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { shpRoutes } from './routes.ts';

export default defineModule({
  code: 'SHP',
  name: 'Website shop',
  permissions: [
    { key: 'shp.view', label: 'See the products shown in the website shop', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'shp.manage', label: 'Add, change, hide and show website shop products and their photos', defaultRoles: ['encoder', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: shpRoutes,
});
