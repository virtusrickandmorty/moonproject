/**
 * Starts the server on the practice shop's made-up data (PLAN C8): 30 days of it, made through the same routes staff use
 * (platform/practice/data.ts) into E2E_DIR/practice, then served like the real shop. The made-up users' passwords are
 * written to E2E_DIR/practice-passwords.json for the every-screen spec.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { manilaDate } from '@moonproject/shared';
import { practiceStart } from '../apps/server/src/platform/practice/shop.ts';
import { createPracticeData } from '../apps/server/src/platform/practice/data.ts';

const dir = process.env.E2E_DIR;
if (!dir) throw new Error('E2E_DIR is not set: run this through `npm run e2e`.');
const folder = join(dir, 'practice');
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });
const db = join(folder, 'moonproject.db');
const summary = await createPracticeData(db, 30, practiceStart(manilaDate(new Date()), 30));
writeFileSync(join(dir, 'practice-passwords.json'), JSON.stringify(summary.passwords));
process.env.MOONPROJECT_DB = db;
process.env.MOONPROJECT_BACKUP_DIR = join(folder, 'backups');
mkdirSync(process.env.MOONPROJECT_BACKUP_DIR, { recursive: true });
await import('../apps/server/src/main.ts');
