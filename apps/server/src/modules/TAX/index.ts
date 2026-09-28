import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { taxRoutes } from './routes.ts';
import { vatCloseDoc } from './doctypes/vat-close.ts';

export default defineModule({
  code: 'TAX',
  name: 'Tax Compliance',
  permissions: [
    { key: 'tax.booklets.view', label: 'See the invoice and receipt booklet register and what each number was used for', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'tax.registers.view', label: 'See and export the tax registers (sales, the 2307s received) and the VAT of a quarter', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.calendar.view', label: 'See the tax calendar: which BIR returns are due and when', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.vatc.view', label: 'See the quarterly VAT closes', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.vatc.post', label: "Close a quarter's VAT (2550Q): output less input VAT into VAT payable or carry-over", defaultRoles: ['accountant'] },
    { key: 'tax.vatc.cancel', label: 'Cancel a quarterly VAT close', defaultRoles: ['accountant'] },
    { key: 'tax.booklets.manage', label: 'Register, retire and switch back on invoice and receipt booklets', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [vatCloseDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: taxRoutes,
});
