-- A Purchasing role (the owner's decision, Oct 9, 2026): the roles become departments: Administrator (owner), Accounting
-- (accountant), Sales (encoder), Production, Purchasing (new) and Live view (tv). Only the screen names change for the
-- others; their keys stay. SQLite cannot widen a CHECK in place, so the two tables that name the roles are copied into
-- new ones (same rows) and swapped; dropping a table fires no DELETE trigger, and the no-delete triggers are put back on
-- the new tables after the migration (migrate.ts).
CREATE TABLE role_permissions_next (
  role_key       TEXT NOT NULL CHECK (role_key IN ('encoder','accountant','owner','production','tv','purchasing')),
  permission_key TEXT NOT NULL REFERENCES permissions(key),
  granted        INTEGER NOT NULL CHECK (granted IN (0,1)),
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (role_key, permission_key)
) STRICT;
INSERT INTO role_permissions_next (role_key, permission_key, granted, updated_at) SELECT role_key, permission_key, granted, updated_at FROM role_permissions;
DROP TABLE role_permissions;
ALTER TABLE role_permissions_next RENAME TO role_permissions;

CREATE TABLE user_roles_next (
  user_id    TEXT NOT NULL REFERENCES users(id),
  role_key   TEXT NOT NULL CHECK (role_key IN ('encoder','accountant','owner','production','tv','purchasing')),
  active     INTEGER NOT NULL CHECK (active IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role_key)
) STRICT;
INSERT INTO user_roles_next (user_id, role_key, active, updated_at) SELECT user_id, role_key, active, updated_at FROM user_roles;
DROP TABLE user_roles;
ALTER TABLE user_roles_next RENAME TO user_roles;

-- What Purchasing starts with: what the encoder (Sales) holds now for suppliers, purchase orders and receiving (PUR),
-- supplier bills, payments and advances (AP) and inventory counts (INV); and the basics: home, search, the calendar and
-- the price list (view). Everything else starts off; the owner ticks more on Roles and permissions. On a new install
-- the grid is empty here and the permissions sync gives the same (engine/security/permissions-sync.ts).
INSERT INTO role_permissions (role_key, permission_key, granted, updated_at)
SELECT 'purchasing', p.key,
       CASE WHEN p.key IN ('dash.view', 'nav.search', 'cal.view', 'cat.view') THEN 1
            WHEN p.module IN ('PUR', 'AP', 'INV') AND EXISTS (SELECT 1 FROM role_permissions e WHERE e.role_key = 'encoder' AND e.permission_key = p.key AND e.granted = 1) THEN 1
            ELSE 0 END,
       strftime('%Y-%m-%dT%H:%M:%f', 'now', '+8 hours') || '+08:00'
  FROM permissions p;
