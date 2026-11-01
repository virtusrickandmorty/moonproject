import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { pushRoutes } from './routes.ts';

// Phone notifications (the owner's request, Nov 2026): each signed-in person turns them on for their own phone; a push
// says only what their bell already shows them, so the module needs no permission of its own.
export default defineModule({
  code: 'PUSH',
  name: 'Phone notifications',
  permissions: [],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: pushRoutes,
});
