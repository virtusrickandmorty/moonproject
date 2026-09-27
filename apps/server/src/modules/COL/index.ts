import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { collectionDoc } from './doctypes/collection.ts';
import { refundDoc } from './doctypes/refund.ts';
import { depositTransferDoc } from './doctypes/deposit-transfer.ts';
import { colRoutes } from './routes.ts';

export default defineModule({
  code: 'COL',
  name: 'Collections & Receivables',
  permissions: [
    { key: 'col.view', label: 'View collections and refunds', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'col.create', label: 'Prepare collections and see what a customer can pay on', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'col.post', label: 'Record collections', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'col.cancel', label: 'Cancel or edit recorded collections', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'col.refund', label: 'Pay back customer deposits and cancel refunds', defaultRoles: ['accountant', 'owner'] },
    { key: 'col.transfer', label: 'Move customer deposits to another of their job orders, and cancel such moves', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [collectionDoc, refundDoc, depositTransferDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: colRoutes,
});
