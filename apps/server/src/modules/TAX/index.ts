import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { taxRoutes } from './routes.ts';

export default defineModule({
  code: 'TAX',
  name: 'Tax Compliance',
  permissions: [
    { key: 'tax.booklets.view', label: 'See the invoice and receipt booklet register and what each number was used for', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'tax.registers.view', label: 'See and export the tax registers: sales, and the 2307s received', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.booklets.manage', label: 'Register, retire and switch back on invoice and receipt booklets', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: taxRoutes,
});
