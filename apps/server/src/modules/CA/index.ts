import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { advanceDoc } from './doctypes/advance.ts';
import { openingCaDoc } from './doctypes/opening.ts';
import { repaymentDoc } from './doctypes/repayment.ts';
import { writeoffDoc } from './doctypes/writeoff.ts';
import { caRoutes } from './routes.ts';

export default defineModule({
  code: 'CA',
  name: 'Cash Advances',
  permissions: [
    { key: 'ca.view', label: 'View cash advances and what employees owe', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'ca.give', label: 'Give cash advances (bale) and record repayments', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'ca.cancel', label: 'Cancel or edit recorded cash advances and repayments', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'ca.writeoff', label: 'Write off what an employee owes on cash advances (and cancel write-offs)', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [advanceDoc, repaymentDoc, writeoffDoc, openingCaDoc], // ca.opening takes ACC's acc.opening.* permissions (OPENING_PERMISSIONS)
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: caRoutes,
});
