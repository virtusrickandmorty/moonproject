import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { quotationDoc } from './doctypes/quotation.ts';

export default defineModule({
  code: 'QUO',
  name: 'Quotations',
  permissions: [
    { key: 'quo.view', label: 'View quotations', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'quo.create', label: 'Prepare quotation drafts and previews', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'quo.post', label: 'Record quotations', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'quo.cancel', label: 'Cancel or reissue quotations', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [quotationDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
});
