-- Each person's own order of the side menu: the groups, and the screens within each group, as they arranged them.
-- Only a convenience: a screen it does not name keeps its usual place after the ones it does, and a name it keeps for a
-- screen the person can no longer open is skipped. Saving again replaces it; "Reset to default" stores an empty order.
CREATE TABLE pref_menu_order (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  groups_json TEXT NOT NULL,      -- ["Sales", "Overview", ...]
  items_json TEXT NOT NULL,       -- {"Sales": ["/pos", "/cus", ...], ...}: the screens' addresses, in order
  updated_at TEXT NOT NULL
) STRICT;
