import { defineModule } from '../../engine/documents/registry.ts';
import { audRoutes } from './routes.ts';

export default defineModule({
  code: 'AUD',
  name: 'Audit & Integrity',
  permissions: [
    { key: 'aud.log.view', label: 'View and export the audit log', defaultRoles: ['accountant', 'owner'] },
    { key: 'aud.integrity.view', label: 'Run the integrity checks', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [],
  routes: audRoutes,
});
