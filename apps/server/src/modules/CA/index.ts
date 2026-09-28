import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { advanceDoc } from './doctypes/advance.ts';
import { caRoutes } from './routes.ts';

export default defineModule({
  code: 'CA',
  name: 'Cash Advances',
  permissions: [
    { key: 'ca.view', label: 'View cash advances and what employees owe', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'ca.give', label: 'Give cash advances (bale)', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'ca.cancel', label: 'Cancel or edit recorded cash advances', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [advanceDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: caRoutes,
});
