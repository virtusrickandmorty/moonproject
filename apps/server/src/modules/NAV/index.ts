import { defineModule } from '../../engine/documents/registry.ts';
import { navRoutes } from './routes.ts';

export default defineModule({
  code: 'NAV', name: 'Navigation', migrationsDir: undefined, docTypes: [], routes: navRoutes,
  permissions: [{ key: 'nav.search', label: 'Use global search', defaultRoles: ['encoder', 'accountant', 'owner', 'production', 'tv'] }],
});
