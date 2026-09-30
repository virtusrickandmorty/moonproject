import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { collectionDoc } from './doctypes/collection.ts';
import { refundDoc } from './doctypes/refund.ts';
import { depositTransferDoc } from './doctypes/deposit-transfer.ts';
import { cwtOnlyDoc } from './doctypes/cwt-only.ts';
import { forfeitDoc } from './doctypes/forfeit.ts';
import { creditMemoDoc } from './doctypes/credit-memo.ts';
import { writeOffDoc } from './doctypes/write-off.ts';
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
    { key: 'col.cwt_only', label: 'Record a customer 2307 that came with no payment, and cancel it', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'col.forfeit', label: 'Keep the deposit of a job order the customer abandoned (forfeit), and cancel it', defaultRoles: ['accountant', 'owner'] },
    { key: 'col.credit_memo', label: 'Record credit memos (returns and allowances on an invoice), and cancel them', defaultRoles: ['accountant'] },
    { key: 'col.write_off', label: 'Write off what an invoice still owes as a bad debt, and cancel it', defaultRoles: ['accountant'] },
  ],
  docTypes: [collectionDoc, refundDoc, depositTransferDoc, cwtOnlyDoc, forfeitDoc, creditMemoDoc, writeOffDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: colRoutes,
});
