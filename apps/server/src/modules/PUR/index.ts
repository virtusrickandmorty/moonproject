import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { purRoutes } from './routes.ts';
import { purchaseOrderDoc } from './doctypes/purchaseOrder.ts';
import { purchaseRequestDoc } from './doctypes/request.ts';
import { receivingReportDoc } from './doctypes/receiving.ts';

export default defineModule({
  code: 'PUR',
  name: 'Suppliers & Purchasing',
  permissions: [
    { key: 'pur.supplier.view', label: 'View suppliers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'pur.supplier.edit', label: 'Edit suppliers', defaultRoles: ['accountant', 'owner'] },
    { key: 'pur.supply.view', label: 'View supplies', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'pur.supply.edit', label: 'Edit supplies', defaultRoles: ['accountant', 'owner'] },
    { key: 'pur.request.view', label: 'View purchase requests', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'pur.request.create', label: 'Ask to buy something (record purchase requests)', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'pur.request.cancel', label: 'Cancel or edit recorded purchase requests', defaultRoles: ['encoder', 'accountant', 'owner'] },
    // The owner's decision (26 Oct 2026): the owner or the accountant approves; encoders and Purchasing do not get these with the accountant's access.
    { key: 'pur.request.approve', label: 'Approve or reject purchase requests', defaultRoles: ['accountant', 'owner'] },
    { key: 'pur.po.without_request', label: 'Make a purchase order without an approved purchase request', defaultRoles: ['accountant', 'owner'] },
    { key: 'pur.po.view', label: 'View purchase orders', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'pur.po.create', label: 'Create purchase orders', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'pur.po.post', label: 'Post purchase orders', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'pur.po.cancel', label: 'Cancel purchase orders', defaultRoles: ['accountant', 'owner'] },
    { key: 'pur.po.print', label: 'Print purchase orders', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'pur.rr.view', label: 'View receiving reports', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'pur.rr.create', label: 'Create receiving reports', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'pur.rr.post', label: 'Post receiving reports', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'pur.rr.cancel', label: 'Cancel receiving reports', defaultRoles: ['accountant', 'owner'] },
    { key: 'pur.rr.print', label: 'Print receiving reports', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [purchaseRequestDoc, purchaseOrderDoc, receivingReportDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: purRoutes,
});
