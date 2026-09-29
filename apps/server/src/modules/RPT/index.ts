import { defineModule } from '../../engine/documents/registry.ts';
import { rptRoutes } from './routes.ts';

export default defineModule({
  code: 'RPT',
  name: 'Books & Statements',
  permissions: [
    { key: 'rpt.books.view', label: 'View and export accounting books and financial statements', defaultRoles: ['accountant', 'owner'] },
    { key: 'rpt.signins.view', label: 'View sign-in history', defaultRoles: ['owner'] },
  ],
  docTypes: [],
  routes: rptRoutes,
});
