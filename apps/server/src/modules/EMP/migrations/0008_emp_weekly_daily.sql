-- migrate: rebuild-with-foreign-keys-off
-- A weekly daily-paid group, WEEKLY_DAILY (the owner's decision, Oct 9, 2026): daily-rated staff paid every week
-- (Friday to Thursday), in their own payroll runs apart from the piece-rate workers. The pay profile's CHECK on the group
-- is widened by copying the table (same rows, same ids), as SQLite requires; its index and trigger are made again.
CREATE TABLE emp_pay_profiles_next (
  id                 INTEGER PRIMARY KEY,
  employee_id        TEXT NOT NULL REFERENCES emp_employees(id),
  effective_from     TEXT NOT NULL,
  pay_type           TEXT NOT NULL CHECK (pay_type IN ('daily','piece','monthly','mixed')),
  daily_rate_cents   INTEGER CHECK (daily_rate_cents > 0),
  monthly_rate_cents INTEGER CHECK (monthly_rate_cents > 0),
  pay_group          TEXT NOT NULL CHECK (pay_group IN ('WEEKLY_PIECE','WEEKLY_DAILY','SEMI_DAILY','SEMI_MONTHLY')),
  workweek_days      INTEGER NOT NULL CHECK (workweek_days IN (5,6)),
  is_mwe             INTEGER NOT NULL CHECK (is_mwe IN (0,1)), -- minimum wage earner: SMW, holiday pay and OT are tax-exempt (F1)
  reason             TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  CHECK ((pay_type IN ('daily','mixed')) = (daily_rate_cents IS NOT NULL)),
  CHECK ((pay_type = 'monthly') = (monthly_rate_cents IS NOT NULL)),
  CHECK ((pay_type = 'monthly') = (pay_group = 'SEMI_MONTHLY'))
) STRICT;
INSERT INTO emp_pay_profiles_next (id, employee_id, effective_from, pay_type, daily_rate_cents, monthly_rate_cents, pay_group, workweek_days, is_mwe, reason, created_at, created_by)
SELECT id, employee_id, effective_from, pay_type, daily_rate_cents, monthly_rate_cents, pay_group, workweek_days, is_mwe, reason, created_at, created_by FROM emp_pay_profiles;
DROP TABLE emp_pay_profiles;
ALTER TABLE emp_pay_profiles_next RENAME TO emp_pay_profiles;
CREATE INDEX emp_pay_profiles_at ON emp_pay_profiles(employee_id, effective_from);
CREATE TRIGGER emp_pay_profiles_no_update BEFORE UPDATE ON emp_pay_profiles
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a pay change is a new row from its effective date'); END;
