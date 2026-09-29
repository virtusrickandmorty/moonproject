/** Starts the server on an empty database and backup folder inside E2E_DIR (a temporary folder), with the built web app. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.E2E_DIR;
if (!dir) throw new Error('E2E_DIR is not set: run this through `npm run e2e`.');
mkdirSync(join(dir, 'backups'), { recursive: true });
process.env.MOONPROJECT_DB = join(dir, 'data', 'moonproject.db');
process.env.MOONPROJECT_BACKUP_DIR = join(dir, 'backups');
await import('../apps/server/src/main.ts');
