import { defineModule } from '../../engine/documents/registry.ts';
import { navRoutes } from './routes.ts';

export default defineModule({
  code: 'NAV',
  name: 'Navigation',
  permissions: [{ key: 'nav.search', label: 'Use global search', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] }],
  docTypes: [],
  routes: navRoutes,
});
