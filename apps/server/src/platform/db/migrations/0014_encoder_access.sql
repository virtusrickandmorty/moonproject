-- Encoders get the accountant's access (the owner's decision of 6 Oct 2026): every permission the accountant role holds
-- now is granted to the encoder role too, except what stays the owner's: users and roles, backups and restores, and the
-- shop's payment settings (engine/security/permissions-sync.ts OWNER_ONLY_PERMISSIONS, which repeats this list). Grants
-- are only switched on, never off: nothing the encoder role already holds is taken away. On a new install the grid is
-- still empty here, and the permissions sync gives new permissions the same way.
INSERT INTO role_permissions (role_key, permission_key, granted, updated_at)
SELECT 'encoder', a.permission_key, 1, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+8 hours') || '+08:00'
  FROM role_permissions a
 WHERE a.role_key = 'accountant' AND a.granted = 1
   AND a.permission_key NOT IN ('sec.users.manage', 'bak.view', 'bak.run', 'bak.manage', 'bak.restore', 'shp.payment.manage')
ON CONFLICT (role_key, permission_key) DO UPDATE SET granted = 1, updated_at = excluded.updated_at WHERE role_permissions.granted = 0;
