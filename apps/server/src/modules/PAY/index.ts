import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { runDoc } from './doctypes/run.ts';
import { releaseDoc } from './doctypes/release.ts';
import { payRoutes } from './routes.ts';

// Payroll is for the accountant and owners by default (OWN-12: encoders see no payroll). pay.view_rates is declared by EMP.
export default defineModule({
  code: 'PAY',
  name: 'Payroll',
  permissions: [
    { key: 'pay.run.view', label: 'View payroll runs and payslips', defaultRoles: ['accountant', 'owner'] },
    { key: 'pay.run.create', label: 'Work out payroll runs (preview)', defaultRoles: ['accountant', 'owner'] },
    { key: 'pay.run.post', label: 'Record payroll runs', defaultRoles: ['accountant', 'owner'] },
    { key: 'pay.run.cancel', label: 'Cancel recorded payroll runs', defaultRoles: ['accountant', 'owner'] },
    { key: 'pay.release.view', label: 'View payroll releases', defaultRoles: ['accountant', 'owner'] },
    { key: 'pay.release.post', label: 'Release net pay (pay out a payroll)', defaultRoles: ['accountant', 'owner'] },
    { key: 'pay.release.cancel', label: 'Cancel recorded payroll releases', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [runDoc, releaseDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: payRoutes,
});
