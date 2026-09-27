-- EMP module tables (prefix emp_), PLAN E11: the employee master, pay profile history, attendance and holidays.
-- It posts nothing. Tests and fixtures use made-up people only; the real list comes through the importer (MIG-01).

-- Employee master. id, code, full_name and is_active are the columns PRD read before EMP existed (PRD/emp.ts); they keep
-- those names. Master data: edited in place with If-Match and an audit row, never deleted; a separation sets is_active 0.
CREATE TABLE emp_employees (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  full_name            TEXT NOT NULL,
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), -- 0 once separated
  position             TEXT,
  department           TEXT,
  cost_centre          TEXT NOT NULL CHECK (cost_centre IN ('production','office')), -- where payroll books the pay (ACC-19)
  hire_date            TEXT NOT NULL,
  separated_on         TEXT,
  separation_reason    TEXT,
  birthday             TEXT,
  -- Statutory switches: ON for everyone by default; switching one off needs a reason (OWN-07).
  sss_on               INTEGER NOT NULL DEFAULT 1 CHECK (sss_on IN (0,1)),
  phic_on              INTEGER NOT NULL DEFAULT 1 CHECK (phic_on IN (0,1)),
  hdmf_on              INTEGER NOT NULL DEFAULT 1 CHECK (hdmf_on IN (0,1)),
  wtax_on              INTEGER NOT NULL DEFAULT 1 CHECK (wtax_on IN (0,1)),
  statutory_off_reason TEXT,
  -- Government IDs: shown and changed only with emp.view_ids.
  sss_no               TEXT,
  phic_no              TEXT,
  hdmf_no              TEXT,
  tin                  TEXT,
  payout_method        TEXT NOT NULL DEFAULT 'cash' CHECK (payout_method IN ('cash','bank','gcash')),
  payout_account       TEXT,
  emergency_contact    TEXT,
  version              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  CHECK ((is_active = 0) = (separated_on IS NOT NULL)),
  CHECK ((separated_on IS NULL) = (separation_reason IS NULL)),
  CHECK (separated_on IS NULL OR separated_on >= hire_date),
  CHECK ((sss_on AND phic_on AND hdmf_on AND wtax_on) OR statutory_off_reason IS NOT NULL)
) STRICT;
CREATE TRIGGER emp_employees_fixed BEFORE UPDATE OF id, code, created_at ON emp_employees
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an employee keeps their id and code'); END;

-- Pay profile history (effective-dated, insert-only): the row with the latest effective_from on or before a date counts,
-- the latest row on a tie. Rates are seen only with pay.view_rates (PLAN C6, N-05).
CREATE TABLE emp_pay_profiles (
  id                 INTEGER PRIMARY KEY,
  employee_id        TEXT NOT NULL REFERENCES emp_employees(id),
  effective_from     TEXT NOT NULL,
  pay_type           TEXT NOT NULL CHECK (pay_type IN ('daily','piece','monthly','mixed')),
  daily_rate_cents   INTEGER CHECK (daily_rate_cents > 0),
  monthly_rate_cents INTEGER CHECK (monthly_rate_cents > 0),
  pay_group          TEXT NOT NULL CHECK (pay_group IN ('WEEKLY_PIECE','SEMI_DAILY','SEMI_MONTHLY')),
  workweek_days      INTEGER NOT NULL CHECK (workweek_days IN (5,6)),
  is_mwe             INTEGER NOT NULL CHECK (is_mwe IN (0,1)), -- minimum wage earner: SMW, holiday pay and OT are tax-exempt (F1)
  reason             TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  CHECK ((pay_type IN ('daily','mixed')) = (daily_rate_cents IS NOT NULL)),
  CHECK ((pay_type = 'monthly') = (monthly_rate_cents IS NOT NULL)),
  CHECK ((pay_type = 'monthly') = (pay_group = 'SEMI_MONTHLY'))
) STRICT;
CREATE INDEX emp_pay_profiles_at ON emp_pay_profiles(employee_id, effective_from);
CREATE TRIGGER emp_pay_profiles_no_update BEFORE UPDATE ON emp_pay_profiles
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a pay change is a new row from its effective date'); END;

-- Attendance: one day per employee (PLAN E11 day grid). Typed by the encoder or accountant; a change is a new seq for
-- that day, and the latest one counts, so the history is kept.
CREATE TABLE emp_attendance (
  employee_id TEXT NOT NULL REFERENCES emp_employees(id),
  work_date   TEXT NOT NULL,
  seq         INTEGER NOT NULL CHECK (seq >= 1),
  status      TEXT NOT NULL CHECK (status IN ('present','half_day','absent','rest_day','leave','unpaid_leave','holiday_off','holiday_worked','rest_day_worked')),
  ot_minutes  INTEGER NOT NULL CHECK (ot_minutes BETWEEN 0 AND 960),
  note        TEXT,
  at          TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (employee_id, work_date, seq),
  CHECK (ot_minutes = 0 OR status IN ('present','holiday_worked','rest_day_worked'))
) STRICT;
CREATE TRIGGER emp_attendance_follow_on BEFORE INSERT ON emp_attendance
WHEN NEW.seq <> COALESCE((SELECT MAX(seq) FROM emp_attendance WHERE employee_id = NEW.employee_id AND work_date = NEW.work_date), 0) + 1
BEGIN SELECT RAISE(ABORT, 'EMP_ATTENDANCE: a change must follow on from the current one'); END;
CREATE TRIGGER emp_attendance_no_update BEFORE UPDATE ON emp_attendance
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an attendance change is a new row'); END;

-- Holidays (PLAN E11, F1): regular or special non-working. Added by the accountant (local days, OWN-29) and switched off
-- with a reason, never edited or deleted. One active holiday per date.
CREATE TABLE emp_holidays (
  id                 INTEGER PRIMARY KEY,
  holiday_date       TEXT NOT NULL,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('regular','special')),
  source             TEXT NOT NULL,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  deactivated_reason TEXT,
  created_at         TEXT NOT NULL,
  created_by         TEXT REFERENCES users(id), -- NULL for the seed below
  CHECK ((is_active = 0) = (deactivated_reason IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX emp_holidays_one_per_day ON emp_holidays(holiday_date) WHERE is_active = 1;
CREATE TRIGGER emp_holidays_fixed BEFORE UPDATE OF id, holiday_date, name, kind, source, created_at, created_by ON emp_holidays
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: switch a holiday off and add the right one'); END;
CREATE TRIGGER emp_holidays_off_once BEFORE UPDATE OF is_active ON emp_holidays WHEN OLD.is_active = 0
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a holiday switched off stays off; add it again'); END;

-- 2026 national holidays (PLAN E11: Proclamation 1006, s. 2025, plus Eid'l Fitr and Eid'l Adha). The accountant checks
-- them against the proclamation and adds local Cavite/Silang days (OWN-29).
INSERT INTO emp_holidays (holiday_date, name, kind, source, created_at) VALUES
  ('2026-01-01', 'New Year''s Day',                     'regular', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-02-17', 'Chinese New Year',                    'special', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-03-20', 'Eid''l Fitr',                         'regular', 'PLAN E11 (Eid''l Fitr, Mar 20)',    '2026-09-28T00:00:00.000+08:00'),
  ('2026-04-02', 'Maundy Thursday',                     'regular', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-04-03', 'Good Friday',                         'regular', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-04-04', 'Black Saturday',                      'special', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-04-09', 'Araw ng Kagitingan',                  'regular', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-05-01', 'Labor Day',                           'regular', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-05-27', 'Eid''l Adha',                         'regular', 'PLAN E11 (Eid''l Adha, May 27)',    '2026-09-28T00:00:00.000+08:00'),
  ('2026-06-12', 'Independence Day',                    'regular', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-08-21', 'Ninoy Aquino Day',                    'special', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-08-31', 'National Heroes Day',                 'regular', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-10-31', 'All Saints'' Day Eve',                'special', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-11-01', 'All Saints'' Day',                    'special', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-11-30', 'Bonifacio Day',                       'regular', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-12-08', 'Feast of the Immaculate Conception',  'special', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-12-24', 'Christmas Eve',                       'special', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-12-25', 'Christmas Day',                       'regular', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-12-30', 'Rizal Day',                           'regular', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00'),
  ('2026-12-31', 'Last Day of the Year',                'special', 'Proclamation 1006 (2026 holidays)', '2026-09-28T00:00:00.000+08:00');
