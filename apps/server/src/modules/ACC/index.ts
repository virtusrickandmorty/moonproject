import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { jvDoc } from './doctypes/jv.ts';
import { accRoutes } from './routes.ts';

export default defineModule({
  code: 'ACC',
  name: 'Accounting & Journals',
  permissions: [
    { key: 'acc.coa.view', label: 'See the chart of accounts with balances', defaultRoles: ['accountant', 'owner'] },
    { key: 'acc.coa.manage', label: 'Add, rename, reserve and deactivate accounts', defaultRoles: ['accountant'] },
    { key: 'acc.jv.create', label: 'Prepare journal vouchers', defaultRoles: ['accountant'] },
    { key: 'acc.jv.post', label: 'Record journal vouchers', defaultRoles: ['accountant'] },
    { key: 'acc.jv.cancel', label: 'Cancel or edit recorded journal vouchers', defaultRoles: ['accountant'] },
    { key: 'acc.settings.manage', label: 'Change dated settings (VAT rate, deposit VAT mode, CR mode, TWA)', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [jvDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: accRoutes,
});
