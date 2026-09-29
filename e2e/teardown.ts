import { rmSync } from 'node:fs';

/** Throws the temporary shop away, database and backups included. */
export default function teardown() {
  if (process.env.E2E_DIR) rmSync(process.env.E2E_DIR, { recursive: true, force: true });
}
