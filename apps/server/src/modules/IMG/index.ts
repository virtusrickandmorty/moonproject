import { defineModule } from '../../engine/documents/registry.ts';
import { imgRoutes } from './routes.ts';

/** Image tools (the owner's request, Oct 2026): background removal and upscaling on the shop PC. No tables. */
export default defineModule({
  code: 'IMG',
  name: 'Image Tools',
  permissions: [
    { key: 'img.use', label: 'Use the image tools: remove a picture\'s background and upscale it', defaultRoles: ['encoder', 'accountant', 'owner'] },
  ],
  docTypes: [],
  migrationsDir: undefined,
  routes: imgRoutes,
});
