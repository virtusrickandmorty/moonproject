/**
 * Keeps the permissions table in step with what modules declare. A permission seen for the first time
 * gets its default role grants; after that the owner's grid is never overwritten.
 * Encoders have the accountant's access (the owner's decision of 6 Oct 2026; migration 0014 did it for the grid then):
 * a new permission the accountant gets by default goes to the encoder too, unless it is one of the owner's own.
 */
import type { Db } from '../../platform/db/driver.ts';
import type { Registry } from '../documents/registry.ts';
import { ROLES, type RoleKey } from '@moonproject/shared';

/**
 * What stays the owner's even though an accountant may hold it: users and roles, backups and restores, and the shop's
 * payment settings. (The shop certificate screen has no permission: it is read only, and the certificate is made on the
 * server PC.) Migration 0014_encoder_access.sql repeats this list.
 */
export const OWNER_ONLY_PERMISSIONS: readonly string[] = ['sec.users.manage', 'bak.view', 'bak.run', 'bak.manage', 'bak.restore', 'shp.payment.manage'];

/** The roles a new permission is granted to: its defaults, plus the encoder wherever the accountant has it. */
export function defaultGrants(key: string, defaultRoles: readonly RoleKey[]): RoleKey[] {
  const encoderToo = defaultRoles.includes('accountant') && !OWNER_ONLY_PERMISSIONS.includes(key);
  return ROLES.filter((r) => defaultRoles.includes(r) || (r === 'encoder' && encoderToo));
}

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
      const grants = defaultGrants(p.key, p.defaultRoles);
      for (const role of ROLES) insGrant.run(role, p.key, grants.includes(role) ? 1 : 0, at);
    }
  }).immediate();
}
