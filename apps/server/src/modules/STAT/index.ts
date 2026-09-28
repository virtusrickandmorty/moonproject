import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { remittanceDoc } from './doctypes/remittance.ts';
import { statRoutes } from './routes.ts';

// Government remittances are the accountant's and owners' (OWN-12: encoders see no payroll).
export default defineModule({
  code: 'STAT',
  name: 'Statutory',
  permissions: [
    { key: 'stat.view', label: 'View the SSS, PhilHealth and Pag-IBIG lists, the 1601-C worksheet and the remittance check', defaultRoles: ['accountant', 'owner'] },
    { key: 'stat.rem.view', label: 'View government remittances', defaultRoles: ['accountant', 'owner'] },
    { key: 'stat.rem.post', label: 'Record government remittances (SSS, PhilHealth, Pag-IBIG, 1601-C)', defaultRoles: ['accountant', 'owner'] },
    { key: 'stat.rem.cancel', label: 'Cancel recorded government remittances', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [remittanceDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: statRoutes,
});
