import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { jvDoc } from './doctypes/jv.ts';
import { openingDoc } from './doctypes/opening.ts';
import { monthEndRoutes } from './month-end.ts';
import { openingRoutes } from './opening.ts';
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
    { key: 'acc.monthend.view', label: 'See the month-end checklist', defaultRoles: ['accountant', 'owner'] },
    { key: 'acc.monthend.signoff', label: 'Sign a month off on the month-end checklist', defaultRoles: ['accountant'] },
    { key: 'acc.opening.view', label: 'See the opening balances and the cut-over checks', defaultRoles: ['accountant', 'owner'] },
    { key: 'acc.opening.create', label: 'Prepare opening balances', defaultRoles: ['accountant'] },
    { key: 'acc.opening.post', label: 'Record opening balances, set the cut-over date and close the opening', defaultRoles: ['accountant'] },
    { key: 'acc.opening.cancel', label: 'Cancel or edit recorded opening balances before the close', defaultRoles: ['accountant'] },
  ],
  docTypes: [jvDoc, openingDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes(app, deps) {
    accRoutes(app, deps);
    openingRoutes(app, deps);
    monthEndRoutes(app, deps);
  },
});
