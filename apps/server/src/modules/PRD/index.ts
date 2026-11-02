import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { entryDoc } from './doctypes/entry.ts';
import { prdRoutes } from './routes.ts';
import { onJobOrderEdited } from '../JO/public.ts';
import { carryProductionOver } from './carry.ts';

// An edited job order keeps its production (the owner's request, Oct 2026).
onJobOrderEdited(carryProductionOver);

export default defineModule({
  code: 'PRD',
  name: 'Production',
  permissions: [
    { key: 'prd.view', label: 'View the production board and production entries', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'prd.tv', label: 'View the read-only TV production board', defaultRoles: ['production', 'accountant', 'owner', 'tv'] },
    { key: 'prd.assign', label: 'Record and cancel workers’ pieces (production entries)', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'prd.progress', label: 'Set a line’s route, and mark steps completed, not needed or reopened', defaultRoles: ['encoder', 'accountant', 'owner', 'production'] },
    { key: 'prd.steps', label: 'Rename production steps and switch them on or off', defaultRoles: ['accountant', 'owner'] },
    // The floor app (the owner's request, Nov 2026): a worker's own sign-in records only their own pieces, today, and sees
    // only their own earnings; whose they are comes from the sign-in's link to the employee (EMP floor-users).
    { key: 'prd.floor', label: 'Use the floor app: record my own pieces and see my own earnings', defaultRoles: ['worker'] },
    // Pieces scanned on the floor app wait for the production head's check (the owner's request, Nov 2026). The owner
    // gives it to the production head's role (plan C6 keeps the Production role to view and assign keys).
    { key: 'prd.verify', label: 'Check the pieces workers scan on the floor app: approve or reject them', defaultRoles: ['owner'] },
    { key: 'prd.reassign', label: 'Change the worker on pieces already recorded (not yet paid)', defaultRoles: ['accountant', 'owner'] },
  ],
  docTypes: [entryDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: prdRoutes,
});
