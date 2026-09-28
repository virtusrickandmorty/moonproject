/** Permissions owned by the engine itself (SEC, AUD, ACC basics). */
import { defineModule } from '../documents/registry.ts';

export const engineModule = defineModule({
  code: 'SEC',
  name: 'Users & Security',
  permissions: [
    { key: 'sec.users.manage', label: 'Manage users, roles and passwords', defaultRoles: ['owner'] },
    { key: 'aud.view', label: 'View the audit trail and integrity checks', defaultRoles: ['owner', 'accountant'] },
    { key: 'acc.journal.view', label: 'See journal entries ("Behind the scenes")', defaultRoles: ['owner', 'accountant'] },
    { key: 'acc.backdate', label: 'Date an accountant document earlier than today', defaultRoles: ['accountant'] },
    { key: 'sec.practice.reset', label: 'Start the practice shop over with new made-up data', defaultRoles: ['owner'] },
  ],
  docTypes: [],
});
