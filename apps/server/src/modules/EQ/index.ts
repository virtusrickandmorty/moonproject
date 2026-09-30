import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { ownerMoneyDoc } from './doctypes/owner-money.ts';
import { officerDoc } from './doctypes/officer.ts';
import { openingOfficerDoc } from './doctypes/opening.ts';
import { dividendDoc } from './doctypes/dividend.ts';
import { dividendPaymentDoc } from './doctypes/dividend-payment.ts';
import { eqRoutes } from './routes.ts';

export default defineModule({
  code: 'EQ',
  name: 'Owners & Officers',
  permissions: [
    { key: 'eq.people.view', label: 'See the register of stockholders and officers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'eq.people.edit', label: 'Add, edit and switch off stockholders and officers', defaultRoles: ['accountant', 'owner'] },
    { key: 'eq.ledger.view', label: 'See the officer ledger (what officers owe and are owed)', defaultRoles: ['accountant', 'owner'] },
    { key: 'eq.own.view', label: 'View owner money', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'eq.own.create', label: 'Prepare owner money', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'eq.own.post', label: 'Record owner money', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'eq.own.cancel', label: 'Cancel or edit recorded owner money', defaultRoles: ['accountant', 'owner'] },
    { key: 'eq.own.classify', label: 'Classify owner money as capital stock or a deposit for future subscription (ACC-10)', defaultRoles: ['accountant'] },
    { key: 'eq.ofc.view', label: 'View officer transactions', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'eq.ofc.create', label: 'Prepare officer transactions', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'eq.ofc.post', label: 'Record officer transactions', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'eq.ofc.cancel', label: 'Cancel or edit recorded officer transactions', defaultRoles: ['accountant', 'owner'] },
    { key: 'eq.div.view', label: 'View dividend declarations', defaultRoles: ['accountant', 'owner'] },
    { key: 'eq.div.create', label: 'Prepare a dividend declaration and see the retained earnings it is checked against', defaultRoles: ['accountant'] },
    { key: 'eq.div.post', label: "Record a dividend the board declared: dividends payable to each stockholder and the final tax withheld", defaultRoles: ['accountant'] },
    { key: 'eq.div.cancel', label: 'Cancel or edit a recorded dividend declaration', defaultRoles: ['accountant'] },
    { key: 'eq.divp.view', label: 'View dividend payments', defaultRoles: ['accountant', 'owner'] },
    { key: 'eq.divp.create', label: 'Prepare a dividend payment', defaultRoles: ['accountant', 'owner'] },
    { key: 'eq.divp.post', label: 'Record a dividend paid to a stockholder', defaultRoles: ['accountant', 'owner'] },
    { key: 'eq.divp.cancel', label: 'Cancel or edit a recorded dividend payment', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [ownerMoneyDoc, officerDoc, openingOfficerDoc, dividendDoc, dividendPaymentDoc], // eq.opening takes ACC's acc.opening.* permissions (OPENING_PERMISSIONS)
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: eqRoutes,
});
