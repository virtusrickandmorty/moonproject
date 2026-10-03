/**
 * Command-line restore, for a new PC after the old one died (PLAN C8: "new PC → Setup → Restore from backup →
 * recovery key"). Run with Virtus stopped:
 *   npm run restore -- D:\Virtus-Backups\offsite\moonproject-2026-09-28T10-00-00-daily.db.gz.age
 * It asks for recovery key A or B, checks the backup like the restore wizard, and puts it in place of the database
 * (MOONPROJECT_DB, default data/moonproject.db); a database already there is kept as before-restore-….db.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { newId } from '@moonproject/shared';
import { openDb } from '../../platform/db/driver.ts';
import { stamp, systemClock } from '../../platform/clock.ts';
import { prepareDatabase } from '../../app.ts';
import { attachmentsBeside } from '../../engine/attachments.ts';
import { loadModules } from '../load.ts';
import { applyPendingRestore, openBackup, recordRestored, requestRestore, restoreDir, stage, stagedPath } from './restore.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run restore -- <backup file ending in .db.gz.age>');
  process.exit(2);
}
const dbFile = process.env.MOONPROJECT_DB ?? 'data/moonproject.db';
mkdirSync(dirname(dbFile), { recursive: true });
const modules = await loadModules();
const blank = openDb(':memory:');
prepareDatabase(blank, systemClock, modules);
const migrations = blank.prepare('SELECT id, checksum FROM schema_migrations ORDER BY id').all() as { id: string; checksum: string }[];

const rl = createInterface({ input: process.stdin, output: process.stdout });
const key = await rl.question('Type recovery key A or B (it starts with AGE-SECRET-KEY-1): ');
rl.close();

const dir = restoreDir(dbFile);
const id = newId();
try {
  const facts = await openBackup(file, key, stagedPath(dir, id), migrations, (copy) => prepareDatabase(copy, systemClock, modules),
    { restoreAttachmentsTo: attachmentsBeside(dbFile) });
  const at = stamp(systemClock);
  stage(dir, { id, file: file.split(/[\\/]/).pop()!, at, userId: null, facts });
  requestRestore(dir, id, at);
  const r = applyPendingRestore(dbFile, at)!;
  const db = openDb(dbFile);
  recordRestored(db, r, at, 'command line');
  db.close();
  console.log(`Restored the backup made ${facts.madeAt ?? '(date unknown: no sidecar)'}: ${facts.postedDocuments} posted documents, books up to ${facts.lastBusinessDate ?? 'no entries'}.`);
  if (facts.attachments.missing.length || facts.attachments.changed.length) {
    console.warn(`Attached files not in the backup or changed, not restored: ${[...facts.attachments.missing, ...facts.attachments.changed].join(', ')}`);
  }
  console.log(`The database it replaced, if any, is kept as ${r.previous}. Start Virtus now.`);
} catch (e) {
  console.error(`Not restored: ${(e as Error).message}`);
  process.exit(1);
}
