import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { loanDoc } from './doctypes/loan.ts';
import { openingLoanDoc } from './doctypes/opening.ts';
import { paymentDoc } from './doctypes/payment.ts';
import { loanRoutes } from './routes.ts';

export default defineModule({
  code: 'LOAN',
  name: 'Loans',
  permissions: [
    { key: 'loan.loans.view', label: 'See the loan register: principal, paid, balance and next instalment', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'loan.ledger.view', label: 'See a loan’s schedule and ledger', defaultRoles: ['accountant', 'owner'] },
    { key: 'loan.in.view', label: 'View recorded loans', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'loan.in.create', label: 'Prepare loans and their schedules', defaultRoles: ['accountant', 'owner'] },
    { key: 'loan.in.post', label: 'Record loans and their schedules', defaultRoles: ['accountant', 'owner'] },
    { key: 'loan.in.cancel', label: 'Cancel or edit recorded loans', defaultRoles: ['accountant', 'owner'] },
    { key: 'loan.in.fee_account', label: 'Post loan fees to an account other than interest and financing charges', defaultRoles: ['accountant'] },
    { key: 'loan.pay.view', label: 'View loan payments', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'loan.pay.create', label: 'Prepare loan payments', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'loan.pay.post', label: 'Record loan payments', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'loan.pay.cancel', label: 'Cancel or edit recorded loan payments', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [loanDoc, paymentDoc, openingLoanDoc], // loan.opening: permissions acc.opening.* (declared by ACC)
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: loanRoutes,
});
