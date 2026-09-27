import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { jobOrderDoc } from './doctypes/job-order.ts';
import { joRoutes } from './routes.ts';

export default defineModule({
  code: 'JO',
  name: 'Job Orders & Release',
  permissions: [
    { key: 'jo.view', label: 'View job orders, their stage and balance due', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.create', label: 'Prepare job orders and pull wearer lists', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.post', label: 'Record job orders', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.cancel', label: 'Cancel or edit recorded job orders', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.stage', label: 'Move job orders between stages', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [jobOrderDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: joRoutes,
});
