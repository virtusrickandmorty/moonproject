import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { buyDoc } from './doctypes/buy.ts';
import { depreciationDoc } from './doctypes/depreciation.ts';
import { disposalDoc } from './doctypes/disposal.ts';
import { faRoutes } from './routes.ts';

export default defineModule({
  code: 'FA',
  name: 'Fixed Assets',
  permissions: [
    { key: 'fa.assets.view', label: 'See the fixed-asset register and asset classes', defaultRoles: ['accountant', 'owner'] },
    { key: 'fa.buy.view', label: 'View fixed-asset purchases', defaultRoles: ['accountant', 'owner'] },
    { key: 'fa.buy.create', label: 'Prepare fixed-asset purchases', defaultRoles: ['accountant', 'owner'] },
    { key: 'fa.buy.post', label: 'Record fixed-asset purchases', defaultRoles: ['accountant', 'owner'] },
    { key: 'fa.buy.cancel', label: 'Cancel or edit recorded fixed-asset purchases', defaultRoles: ['accountant', 'owner'] },
    { key: 'fa.depr.view', label: 'View depreciation runs', defaultRoles: ['accountant', 'owner'] },
    { key: 'fa.depr.create', label: 'Prepare depreciation runs', defaultRoles: ['accountant'] },
    { key: 'fa.depr.post', label: 'Record depreciation runs', defaultRoles: ['accountant'] },
    { key: 'fa.depr.cancel', label: 'Cancel or redo recorded depreciation runs', defaultRoles: ['accountant'] },
    { key: 'fa.disp.view', label: 'View asset disposals', defaultRoles: ['accountant', 'owner'] },
    { key: 'fa.disp.create', label: 'Prepare asset disposals', defaultRoles: ['accountant', 'owner'] },
    { key: 'fa.disp.post', label: 'Record asset disposals', defaultRoles: ['accountant', 'owner'] },
    { key: 'fa.disp.cancel', label: 'Cancel or edit recorded asset disposals', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [buyDoc, depreciationDoc, disposalDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: faRoutes,
});
