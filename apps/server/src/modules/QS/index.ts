import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { saleDoc } from './doctypes/sale.ts';
import { qsRoutes } from './routes.ts';
import { provideCancelQuickSale, provideRecordQuickSale, provideSaleDoc } from './public.ts';
import { cancelQuickSale, recordQuickSale } from './record.ts';

// Other modules record a counter sale through QS's public contract (SHP: confirmed online orders, and cancelling or returning one).
provideRecordQuickSale(recordQuickSale);
provideCancelQuickSale(cancelQuickSale);
// TPL records a delivery's invoice as a quick sale on terms.
provideSaleDoc(saleDoc);

export default defineModule({
  code: 'QS',
  name: 'Quick Sale',
  permissions: [
    { key: 'qs.view', label: 'View quick sales', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'qs.create', label: 'Prepare quick sales', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'qs.post', label: 'Record quick sales (invoice record and payment)', defaultRoles: ['encoder', 'accountant', 'owner'] },
    // Cancelling one cancels an invoice, as for job order invoice records (jo.invoice_cancel).
    { key: 'qs.cancel', label: 'Cancel or edit recorded quick sales', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [saleDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: qsRoutes,
});
