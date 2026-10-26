import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { jobOrderDoc } from './doctypes/job-order.ts';
import { releaseDoc } from './doctypes/release.ts';
import { invoiceRecordDoc } from './doctypes/invoice-record.ts';
import { openingJobOrderDoc } from './doctypes/opening.ts';
import { dpInvoiceDoc } from './doctypes/dp-invoice.ts';
import { joRoutes } from './routes.ts';
import { onMergeCheck } from '../CUS/public.ts';
import { activeJobOrders } from './public.ts';

// A duplicate customer is merged only once its job orders are all released (CUS merge.ts): their documents stay with it.
onMergeCheck((db, customerId) => activeJobOrders(db).filter((j) => j.customerId === customerId && j.stage !== 'released')
  .map((j) => `${j.number} is not fully released yet: finish or cancel it first.`));

export default defineModule({
  code: 'JO',
  name: 'Job Orders & Release',
  permissions: [
    { key: 'jo.view', label: 'View job orders, their stage and balance due', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.create', label: 'Prepare job orders and pull wearer lists', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.post', label: 'Record job orders', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.cancel', label: 'Cancel or edit recorded job orders', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.stage', label: 'Move job orders between stages', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.release', label: 'Release finished orders to the customer (release slip)', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.release_with_balance', label: 'Release an order that still has a balance due, with a note and due date', defaultRoles: ['accountant', 'owner'] },
    // Retired Oct 11, 2026 (the owner's rule: nothing is released before it is ready); kept so the key and its history stay.
    { key: 'jo.release_override', label: 'No longer used: nothing is released before it is ready (owner, Oct 2026)', defaultRoles: ['owner'] },
    { key: 'jo.invoice', label: 'Record the manual invoices written at release (invoice records)', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.invoice_cancel', label: 'Cancel or edit recorded invoice records', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [jobOrderDoc, releaseDoc, invoiceRecordDoc, openingJobOrderDoc, dpInvoiceDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: joRoutes,
});
