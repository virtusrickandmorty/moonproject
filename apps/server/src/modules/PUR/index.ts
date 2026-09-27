import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { purRoutes } from './routes.ts';
import { purchaseOrderDoc } from './doctypes/purchaseOrder.ts';
import { receivingReportDoc } from './doctypes/receiving.ts';

export default defineModule({
  code: 'PUR',
  name: 'Suppliers & Purchasing',
  permissions: [
    { key: 'pur.supplier.view', label: 'View suppliers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'pur.supplier.edit', label: 'Edit suppliers', defaultRoles: ['accountant', 'owner'] },
    { key: 'pur.supply.view', label: 'View supplies', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'pur.supply.edit', label: 'Edit supplies', defaultRoles: ['accountant', 'owner'] },
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
  docTypes: [purchaseOrderDoc, receivingReportDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: purRoutes,
});
