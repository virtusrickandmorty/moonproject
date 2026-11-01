import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { estRoutes } from './routes.ts';
import { estimateDoc } from './doctypes/estimate.ts';

export default defineModule({
  code: 'EST',
  name: 'Costing & Estimates',
  permissions: [
    { key: 'est.view', label: 'See the prices suggested by cost sheets', defaultRoles: ['encoder', 'accountant', 'owner'] },
    // Costs, margins and commission stay with the accountant and the owners (the owner's request, Nov 2026).
    { key: 'est.cost.view', label: 'See costs, margins and commission on cost sheets', defaultRoles: ['accountant', 'owner'] },
    { key: 'est.manage', label: 'Set up cost sheets and the costing rules', defaultRoles: ['accountant', 'owner'] },
    // Estimates show costs and profit, so they are the accountant's and the owners' too.
    { key: 'est.estimate.view', label: 'View cost estimates', defaultRoles: ['accountant', 'owner'] },
    { key: 'est.estimate.create', label: 'Prepare cost estimate drafts and previews', defaultRoles: ['accountant', 'owner'] },
    { key: 'est.estimate.post', label: 'Record cost estimates', defaultRoles: ['accountant', 'owner'] },
    { key: 'est.estimate.cancel', label: 'Cancel or reissue cost estimates', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [estimateDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: estRoutes,
});
