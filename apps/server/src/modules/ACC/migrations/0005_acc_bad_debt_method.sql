-- ACC-26 default: bad debts are written off directly to 6270. The accountant picks the allowance method (1209) from a
-- date with a new version of this setting (POST /api/settings/acc.bad_debt_method).
INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES
('acc.bad_debt_method', '2000-01-01', '"direct"', 'Default at install: bad debts are written off directly (PLAN ACC-26)', '2026-09-29T00:00:00.000+08:00');
