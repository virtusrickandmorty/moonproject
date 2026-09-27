/**
 * Keeps the permissions table in step with what modules declare. A permission seen for the first time
 * gets its default role grants; after that the owner's grid is never overwritten.
 */
import type { Db } from '../../platform/db/driver.ts';
import type { Registry } from '../documents/registry.ts';
import { ROLES } from '@virtus/shared';

export function syncPermissions(db: Db, registry: Registry, at: string): void {
  const insPerm = db.prepare('INSERT INTO permissions (key, module, label) VALUES (?, ?, ?)');
  const updLabel = db.prepare('UPDATE permissions SET label = ? WHERE key = ? AND label <> ?');
  const insGrant = db.prepare('INSERT OR IGNORE INTO role_permissions (role_key, permission_key, granted, updated_at) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (const p of registry.permissions()) {
      const exists = db.prepare('SELECT 1 FROM permissions WHERE key = ?').get(p.key);
      if (exists) {
        updLabel.run(p.label, p.key, p.label);
        continue;
      }
      insPerm.run(p.key, p.module, p.label);
      for (const role of ROLES) insGrant.run(role, p.key, p.defaultRoles.includes(role) ? 1 : 0, at);
    }
  }).immediate();
}
