import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { runDoc } from './doctypes/run.ts';
import { releaseDoc } from './doctypes/release.ts';
import { thirteenthDoc } from './doctypes/thirteenth.ts';
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
    // The 13th-month payout is run by the accountant (D5 TH13-PAY); owners see it.
    { key: 'pay.thirteenth.view', label: 'View 13th-month pay', defaultRoles: ['accountant', 'owner'] },
    { key: 'pay.thirteenth.create', label: 'Work out 13th-month pay (preview)', defaultRoles: ['accountant'] },
    { key: 'pay.thirteenth.post', label: 'Record 13th-month pay', defaultRoles: ['accountant'] },
    { key: 'pay.thirteenth.cancel', label: 'Cancel recorded 13th-month pay', defaultRoles: ['accountant'] },
    { key: 'pay.loans.view', label: 'View employees’ SSS and Pag-IBIG loans', defaultRoles: ['accountant', 'owner'] },
    { key: 'pay.loans.manage', label: 'Register, change and stop employees’ SSS and Pag-IBIG loans', defaultRoles: ['accountant', 'owner'] },
    // Year-end tax adjustment, pay before Moonproject, 2316 and the 1604-C alphalist: the accountant's (F3, F4).
    { key: 'pay.yearend.run', label: 'Do the year-end tax adjustment on a payroll run', defaultRoles: ['accountant'] },
    { key: 'pay.prior.view', label: 'View pay before Moonproject and from previous employers', defaultRoles: ['accountant'] },
    { key: 'pay.prior.manage', label: 'Record and change pay before Moonproject and from previous employers', defaultRoles: ['accountant'] },
    { key: 'pay.yearend.view', label: 'View 2316 data and the 1604-C alphalist', defaultRoles: ['accountant'] },
  ],
  docTypes: [runDoc, releaseDoc, thirteenthDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: payRoutes,
});
