import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { EWT_PERMISSION, billDoc } from './doctypes/bill.ts';
import { openingBillDoc } from './doctypes/opening.ts';
import { paymentDoc } from './doctypes/payment.ts';
import { apRoutes } from './routes.ts';

export default defineModule({
  code: 'AP',
  name: 'Payables',
  permissions: [
    { key: 'ap.bill.view', label: 'View supplier bills', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'ap.bill.create', label: 'Prepare supplier bills', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'ap.bill.post', label: 'Record supplier bills', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'ap.bill.cancel', label: 'Cancel or edit recorded supplier bills', defaultRoles: ['accountant', 'owner'] },
    { key: EWT_PERMISSION, label: 'Change the EWT on a supplier bill from the supplier’s usual class', defaultRoles: ['accountant'] },
    { key: 'ap.pay.view', label: 'View supplier payments', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'ap.pay.create', label: 'Prepare supplier payments', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'ap.pay.post', label: 'Record supplier payments', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'ap.pay.cancel', label: 'Cancel or edit recorded supplier payments', defaultRoles: ['accountant', 'owner'] },
    { key: 'ap.ledger.view', label: 'See what is owed to each supplier (bills, payments, balance)', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [billDoc, paymentDoc, openingBillDoc], // ap.opening takes ACC's acc.opening.* permissions (OPENING_PERMISSIONS)
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: apRoutes,
});
