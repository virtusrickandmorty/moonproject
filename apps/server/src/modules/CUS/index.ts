import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { cusRoutes } from './routes.ts';

export default defineModule({
  code: 'CUS',
  name: 'Customers & Measurements',
  permissions: [
    { key: 'cus.view', label: 'View customer records and contact details', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cus.measure.view', label: 'View wearer sizes and measurements', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'cus.manage', label: 'Create and edit customers, groups and wearers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cus.measure', label: 'Record measurement revisions', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cus.merge', label: 'Merge customer records', defaultRoles: ['owner'] },
    { key: 'cus.sizes.manage', label: 'Manage size choices', defaultRoles: ['owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: cusRoutes,
});
