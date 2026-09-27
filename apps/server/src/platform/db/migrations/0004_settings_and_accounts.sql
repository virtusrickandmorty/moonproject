-- Effective-dated settings (PLAN C3 settings.ts, D4.2, E12) and the chart-of-accounts guard (E12).

-- Fix the seed (0002): other income is revenue with a credit balance, not an expense.
UPDATE accounts SET type = 'revenue', normal_side = 'credit' WHERE code IN ('7100', '7101', '7102', '7103');

-- The accountant renames accounts; a version column lets the screen refuse a stale save (If-Match).
ALTER TABLE accounts ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

-- Code, type, normal side, role key, party type and kind never change once an account exists ("types fixed;
-- role keys locked"). Only the name, sort order, reserved flag, active flag and version may change.
CREATE TRIGGER accounts_fixed_fields BEFORE UPDATE ON accounts
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.type IS NOT OLD.type OR NEW.normal_side IS NOT OLD.normal_side
  OR NEW.role_key IS NOT OLD.role_key OR NEW.party_type IS NOT OLD.party_type OR NEW.is_header IS NOT OLD.is_header
  OR NEW.is_postable IS NOT OLD.is_postable OR NEW.is_cash_place IS NOT OLD.is_cash_place
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an account''s code, type, role and kind never change'); END;

-- An account the posting rules name by role, or one that still holds money for anyone, stays active.
CREATE TRIGGER accounts_deactivate_guard BEFORE UPDATE OF is_active ON accounts
WHEN OLD.is_active = 1 AND NEW.is_active = 0
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_HAS_ROLE: the posting rules use this account') WHERE OLD.role_key IS NOT NULL;
  SELECT RAISE(ABORT, 'ACCOUNT_HAS_BALANCE: the account still has a balance')
    WHERE EXISTS (SELECT 1 FROM journal_lines WHERE account_id = OLD.id
                  GROUP BY party_type, party_id HAVING SUM(debit_cents - credit_cents) <> 0);
END;

-- One row per version. The version in force on a date is the latest effective_from <= that date (ties: latest id).
-- Rows are never edited, so a version a posted document used never changes.
CREATE TABLE settings (
  id             INTEGER PRIMARY KEY,
  key            TEXT NOT NULL,
  effective_from TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  value_json     TEXT NOT NULL CHECK (json_valid(value_json)),
  reason         TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES users(id) -- NULL only for the defaults below
) STRICT;
CREATE INDEX settings_lookup ON settings(key, effective_from, id);
CREATE TRIGGER settings_no_update BEFORE UPDATE ON settings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a setting changes by adding a new dated version'); END;

INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES
('tax.vat_rate_bp', '2000-01-01', '1200', 'Default at install: VAT 12% (PLAN D4.2)', '2026-09-27T00:00:00.000+08:00'),
('sales.deposit_vat_mode', '2000-01-01', '"A"', 'Default until the accountant decides: deposit only (ACC-02)', '2026-09-27T00:00:00.000+08:00'),
('col.cr_mode', '2000-01-01', '{"mode":"booklet"}', 'Default: CR numbers typed from the ATP booklet (ACC-03)', '2026-09-27T00:00:00.000+08:00'),
('tax.top_withholding_agent', '2000-01-01', 'false', 'Default: not a published Top Withholding Agent (ACC-06)', '2026-09-27T00:00:00.000+08:00');
