import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { comRoutes } from './routes.ts';

export default defineModule({
  code: 'COM',
  name: 'Customer Communications',
  permissions: [
    { key: 'com.settings.manage', label: 'Set up customer emails: sending on or off, the mail server and the App Password', defaultRoles: ['owner'] },
    { key: 'com.outbox.view', label: 'See the customer emails that were queued, sent or failed', defaultRoles: ['accountant', 'owner'] },
    { key: 'com.outbox.resend', label: 'Send a failed customer email again', defaultRoles: ['owner'] },
    { key: 'com.statement.send', label: 'Email a statement of account to a customer', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: comRoutes,
});
