import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { aiaRoutes } from './routes.ts';

export default defineModule({
  code: 'AIA',
  name: 'Website AI assistant',
  permissions: [
    { key: 'aia.view', label: 'Read the chats customers had with the website assistant', defaultRoles: ['encoder', 'owner'] },
    { key: 'aia.manage', label: "Switch the website assistant on or off, set its key and what it knows", defaultRoles: ['owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: aiaRoutes,
});
