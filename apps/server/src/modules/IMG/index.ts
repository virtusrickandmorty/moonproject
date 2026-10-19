import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { imgRoutes } from './routes.ts';

/**
 * Image tools (the owner's request, Oct 2026): background removal, upscaling, flat art and vectors on the shop PC; and,
 * paid per picture, the online AI (redraw a jersey photo flat, clean vectors), owner-only with a monthly limit.
 */
export default defineModule({
  code: 'IMG',
  name: 'Image Tools',
  permissions: [
    { key: 'img.use', label: 'Use the image tools: remove a picture\'s background and upscale it', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'img.ai', label: 'Use the paid online AI in the image tools (redraw a jersey flat, clean vectors) and set its key and monthly limit', defaultRoles: ['owner'] },
  ],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: imgRoutes,
});
