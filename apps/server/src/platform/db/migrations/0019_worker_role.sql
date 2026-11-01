-- A Production worker role (the owner's request, Nov 2026): a worker's own sign-in for the floor app on the phone, which
-- records that worker's own pieces and shows their own earnings. The two tables that name the roles are copied into new
-- ones with the wider CHECK (same rows) and swapped, as in 0015 and 0016.
CREATE TABLE role_permissions_next (
  role_key       TEXT NOT NULL CHECK (role_key IN ('encoder','accountant','owner','production','tv','purchasing','hr','worker')),
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
  role_key   TEXT NOT NULL CHECK (role_key IN ('encoder','accountant','owner','production','tv','purchasing','hr','worker')),
  active     INTEGER NOT NULL CHECK (active IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role_key)
) STRICT;
INSERT INTO user_roles_next (user_id, role_key, active, updated_at) SELECT user_id, role_key, active, updated_at FROM user_roles;
DROP TABLE user_roles;
ALTER TABLE user_roles_next RENAME TO user_roles;

-- The worker starts with nothing from the existing permissions: only the floor app's own, which grant it by default
-- (the permissions sync, engine/security/permissions-sync.ts).
INSERT INTO role_permissions (role_key, permission_key, granted, updated_at)
SELECT 'worker', p.key, 0, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+8 hours') || '+08:00' FROM permissions p;
