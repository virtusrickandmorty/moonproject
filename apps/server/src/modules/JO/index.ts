import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { jobOrderDoc } from './doctypes/job-order.ts';
import { releaseDoc } from './doctypes/release.ts';
import { invoiceRecordDoc } from './doctypes/invoice-record.ts';
import { joRoutes } from './routes.ts';

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
    { key: 'jo.release_override', label: 'Release an order before it is marked ready, with a reason', defaultRoles: ['owner'] },
    { key: 'jo.invoice', label: 'Record the manual invoices written at release (invoice records)', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'jo.invoice_cancel', label: 'Cancel or edit recorded invoice records', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [jobOrderDoc, releaseDoc, invoiceRecordDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: joRoutes,
});
