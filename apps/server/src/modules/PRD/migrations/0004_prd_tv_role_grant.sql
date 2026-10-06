-- The TV role exists to show the TV production board (audit A11-003), but installs made before this version
-- gave it no prd.tv grant. Switch it on once. A new install gets it from the permission's defaults instead
-- (this runs before the permission exists there, so it changes nothing).
UPDATE role_permissions
SET granted = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', 'now', '+8 hours')
WHERE role_key = 'tv' AND permission_key = 'prd.tv' AND granted = 0;
