/**
 * USB copies (PLAN C8): two drives, A and B, swapped weekly; one stays away from the shop. Each copy adds the daily,
 * monthly and yearly backups the drive lacks, with their sidecars, then rotates the drive like the backup folder.
 * The drive remembers its letter in moonproject-usb.json, so drive A is never mistaken for drive B.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@moonproject/shared';
import { keptIn, rotate } from './backup.ts';

export type Drive = 'A' | 'B';
const LABEL = 'moonproject-usb.json';

export function copyToUsb(backupDir: string, dir: string, drive: Drive, at: string): { copied: number; onDrive: number } {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const labelFile = join(dir, LABEL);
  if (existsSync(labelFile)) {
    const was = (JSON.parse(readFileSync(labelFile, 'utf8')) as { drive?: Drive }).drive;
    if (was && was !== drive) throw new AppError('WRONG_DRIVE', `This is USB drive ${was}, not ${drive}. Pick drive ${was}, or plug in drive ${drive}.`, 409);
  } else {
    writeFileSync(labelFile, `${JSON.stringify({ app: 'moonproject', drive, since: at }, null, 2)}\n`);
  }
  const there = new Set(keptIn(dir).map((k) => k.file));
  let copied = 0;
  for (const k of keptIn(backupDir).filter((x) => x.tier !== 'snapshot' && !there.has(x.file))) {
    const sidecar = k.file.replace(/\.db\.gz\.age$/, '.json');
    copyFileSync(join(backupDir, k.file), join(dir, k.file));
    copyFileSync(join(backupDir, sidecar), join(dir, sidecar)); // after the backup: a sidecar never names a missing file
    copied++;
  }
  rotate(dir, at);
  return { copied, onDrive: keptIn(dir).length };
}
