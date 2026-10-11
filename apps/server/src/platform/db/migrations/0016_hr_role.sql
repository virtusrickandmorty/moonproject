-- A Human Resource role (the owner's decision, Oct 9, 2026), beside the departments of 0015_purchasing_role.sql. The two
-- tables that name the roles are copied into new ones with the wider CHECK (same rows) and swapped, as in 0015.
CREATE TABLE role_permissions_next (
  role_key       TEXT NOT NULL CHECK (role_key IN ('encoder','accountant','owner','production','tv','purchasing','hr')),
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
  role_key   TEXT NOT NULL CHECK (role_key IN ('encoder','accountant','owner','production','tv','purchasing','hr')),
  active     INTEGER NOT NULL CHECK (active IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role_key)
) STRICT;
INSERT INTO user_roles_next (user_id, role_key, active, updated_at) SELECT user_id, role_key, active, updated_at FROM user_roles;
DROP TABLE user_roles;
ALTER TABLE user_roles_next RENAME TO user_roles;

-- What Human Resource starts with: what the encoder (Sales) holds now for employees, attendance and holidays (EMP),
-- payroll and 13th-month pay (PAY), cash advances (CA) and the government contributions and remittances (STAT); and the
-- basics: home, search and the calendar. Everything else starts off. On a new install the grid is empty here and the
-- permissions sync gives the same (engine/security/permissions-sync.ts).
INSERT INTO role_permissions (role_key, permission_key, granted, updated_at)
SELECT 'hr', p.key,
       CASE WHEN p.key IN ('dash.view', 'nav.search', 'cal.view') THEN 1
            WHEN p.module IN ('EMP', 'PAY', 'CA', 'STAT') AND EXISTS (SELECT 1 FROM role_permissions e WHERE e.role_key = 'encoder' AND e.permission_key = p.key AND e.granted = 1) THEN 1
            ELSE 0 END,
       strftime('%Y-%m-%dT%H:%M:%f', 'now', '+8 hours') || '+08:00'
  FROM permissions p;
