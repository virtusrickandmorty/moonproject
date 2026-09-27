import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { voucherDoc } from './doctypes/voucher.ts';
import { expRoutes } from './routes.ts';

export default defineModule({
  code: 'EXP',
  name: 'Expenses',
  permissions: [
    { key: 'exp.voucher.view', label: 'View expense vouchers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'exp.voucher.create', label: 'Prepare expense vouchers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'exp.voucher.post', label: 'Record expense vouchers', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'exp.voucher.cancel', label: 'Cancel or edit recorded expense vouchers', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [voucherDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: expRoutes,
});
