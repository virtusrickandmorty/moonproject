/**
 * The installed version: ops/windows/stage.mjs writes version.json at the root of the installed app, and
 * GET /api/health reports it, so an update can tell that the new version is the one answering (ops/windows/update.mjs).
 * From the repository it is "dev".
 */
import { readFileSync } from 'node:fs';

function installed(): string {
  try {
    return (JSON.parse(readFileSync(new URL('../../../../version.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return 'dev';
  }
}

export const APP_VERSION = installed();
