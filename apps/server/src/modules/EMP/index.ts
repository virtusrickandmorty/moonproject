import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { empRoutes } from './routes.ts';

export default defineModule({
  code: 'EMP',
  name: 'Employees & Time',
  permissions: [
    { key: 'emp.view', label: 'View employees, attendance and holidays (no pay, IDs masked)', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'emp.manage', label: 'Add and edit employees, and record separations', defaultRoles: ['accountant', 'owner'] },
    { key: 'emp.view_ids', label: 'See and change employees’ SSS, PhilHealth, Pag-IBIG and TIN numbers', defaultRoles: ['accountant', 'owner'] },
    { key: 'emp.pay', label: 'Set an employee’s pay (a new pay profile from a date)', defaultRoles: ['accountant', 'owner'] },
    // The key PLAN C6 and N-05 name. Pay profiles live in EMP; PAY checks the same key for payroll amounts.
    { key: 'pay.view_rates', label: 'See salaries, daily rates and payroll amounts', defaultRoles: ['accountant', 'owner'] },
    { key: 'emp.attendance', label: 'Type attendance (the day grid)', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'emp.holidays', label: 'Add holidays and switch them off', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: empRoutes,
});
