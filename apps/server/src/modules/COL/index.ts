import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { collectionDoc } from './doctypes/collection.ts';
import { refundDoc } from './doctypes/refund.ts';
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
  ],
  docTypes: [collectionDoc, refundDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: colRoutes,
});
