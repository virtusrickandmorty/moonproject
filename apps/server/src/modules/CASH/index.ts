import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { transferDoc } from './doctypes/transfer.ts';
import { countDoc } from './doctypes/count.ts';
import { otherReceiptDoc } from './doctypes/other-receipt.ts';
import { cashRoutes } from './routes.ts';

export default defineModule({
  code: 'CASH',
  name: 'Cash & Banks',
  permissions: [
    { key: 'cash.places.view', label: 'See the list of cash places', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.balances.view_all', label: 'See the balance of every cash place', defaultRoles: ['accountant', 'owner'] },
    { key: 'cash.trf.view', label: 'View fund transfers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.trf.create', label: 'Prepare fund transfers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.trf.post', label: 'Record fund transfers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.trf.cancel', label: 'Cancel or edit recorded fund transfers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.places.manage', label: 'Add cash places and choose who sees their balance', defaultRoles: ['accountant', 'owner'] },
    { key: 'cash.book.view', label: 'See the cash book of the cash places whose balance they see', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.count.view', label: 'View cash counts', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.count.create', label: 'Prepare cash counts', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.count.post', label: 'Record cash counts', defaultRoles: ['encoder', 'accountant', 'owner'] },
    // A short count cancelled by the person who counted would hide it, so cancelling is the accountant's.
    { key: 'cash.count.cancel', label: 'Cancel or edit recorded cash counts', defaultRoles: ['accountant', 'owner'] },
    { key: 'cash.orc.view', label: 'View other receipts', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.orc.create', label: 'Prepare other receipts', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.orc.post', label: 'Record other receipts', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'cash.orc.cancel', label: 'Cancel or edit recorded other receipts', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [transferDoc, countDoc, otherReceiptDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: cashRoutes,
});
