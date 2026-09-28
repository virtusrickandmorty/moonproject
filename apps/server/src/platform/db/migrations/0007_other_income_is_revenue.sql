-- 7100 Other income and its accounts (7101 interest income, 7102 gain on disposal, 7103 other income) were typed as
-- debit-normal expenses by 0002, so the books would show income as a negative expense. They are credit-normal revenue
-- (PLAN chart: "Other income"). Types are locked by accounts_fixed_fields; this one-time correction lifts the guard
-- for these four rows and puts it back exactly as 0005 wrote it. Journal lines are untouched: only how the accounts
-- are classified and which side is their normal balance.
DROP TRIGGER accounts_fixed_fields;
UPDATE accounts SET type = 'revenue', normal_side = 'credit' WHERE code IN ('7100', '7101', '7102', '7103') AND type = 'expense';
CREATE TRIGGER accounts_fixed_fields BEFORE UPDATE ON accounts
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.type IS NOT OLD.type OR NEW.normal_side IS NOT OLD.normal_side
  OR NEW.role_key IS NOT OLD.role_key OR NEW.party_type IS NOT OLD.party_type OR NEW.is_header IS NOT OLD.is_header
  OR NEW.is_postable IS NOT OLD.is_postable OR NEW.is_cash_place IS NOT OLD.is_cash_place
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an account''s code, type, role and kind never change'); END;
