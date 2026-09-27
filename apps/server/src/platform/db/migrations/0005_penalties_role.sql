-- 6290 penalties and surcharges gets the role key PENALTIES, so posting rules can name it (STAT-REM and EWT-REM
-- penalty lines, PLAN D5). Role keys are locked by accounts_fixed_fields; this one-time assignment lifts the guard for
-- a single row and puts it back exactly as 0004 wrote it.
DROP TRIGGER accounts_fixed_fields;
UPDATE accounts SET role_key = 'PENALTIES' WHERE code = '6290' AND role_key IS NULL;
CREATE TRIGGER accounts_fixed_fields BEFORE UPDATE ON accounts
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.type IS NOT OLD.type OR NEW.normal_side IS NOT OLD.normal_side
  OR NEW.role_key IS NOT OLD.role_key OR NEW.party_type IS NOT OLD.party_type OR NEW.is_header IS NOT OLD.is_header
  OR NEW.is_postable IS NOT OLD.is_postable OR NEW.is_cash_place IS NOT OLD.is_cash_place
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an account''s code, type, role and kind never change'); END;
