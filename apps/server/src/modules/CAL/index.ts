import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { calRoutes } from './routes.ts';

export default defineModule({
  code: 'CAL',
  name: 'Calendar',
  permissions: [
    { key: 'cal.view', label: 'View the calendar', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'cal.events.create', label: 'Book, move and cancel calendar events', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: calRoutes,
});
