-- The order of the sub-categories within each menu group, as the person arranged them (the owner's request, Oct 2026):
-- {"Sales": ["Collections", "Customers & quotes", ...], ...}. Empty: the usual order. A sub-category it does not name
-- keeps its usual place after the ones it does.
ALTER TABLE pref_menu_order ADD COLUMN subs_json TEXT NOT NULL DEFAULT '{}';
