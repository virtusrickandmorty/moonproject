-- PAY module tables (prefix pay_), PLAN E11, F1–F3, D5 PAY-RUN and PAY-REL.

-- Statutory and pay rules (F1). Effective-dated and insert-only: a new version is a new row from its date, so a run
-- already worked out keeps the version it used. Contributions use the version on the first day of the contribution
-- month; withholding tax the version on the pay date; the minimum wage and the day rules the version on each work date.
CREATE TABLE pay_sss_rates (
  id                   INTEGER PRIMARY KEY,
  effective_from       TEXT NOT NULL,
  msc_min_cents        INTEGER NOT NULL, -- compensation below min + step/2 gets the minimum MSC
  msc_max_cents        INTEGER NOT NULL,
  msc_step_cents       INTEGER NOT NULL,
  regular_max_cents    INTEGER NOT NULL, -- regular SS up to this MSC; the part above goes to MPF (same rates)
  ee_bp                INTEGER NOT NULL,
  er_bp                INTEGER NOT NULL,
  ec_low_cents         INTEGER NOT NULL, -- employees' compensation, employer only
  ec_high_cents        INTEGER NOT NULL,
  ec_low_max_msc_cents INTEGER NOT NULL, -- EC is the low amount up to this MSC
  source               TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  created_by           TEXT REFERENCES users(id)
) STRICT;
CREATE TABLE pay_phic_rates (
  id             INTEGER PRIMARY KEY,
  effective_from TEXT NOT NULL,
  rate_bp        INTEGER NOT NULL, -- premium, split equally between employee and employer
  floor_cents    INTEGER NOT NULL,
  ceiling_cents  INTEGER NOT NULL,
  days_6         INTEGER NOT NULL, -- daily rate × days_6 / 12 for a 6-day week
  days_5         INTEGER NOT NULL,
  source         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES users(id)
) STRICT;
CREATE TABLE pay_hdmf_rates (
  id             INTEGER PRIMARY KEY,
  effective_from TEXT NOT NULL,
  ee_bp          INTEGER NOT NULL,
  ee_low_bp      INTEGER NOT NULL, -- when monthly compensation is at most low_max_cents
  low_max_cents  INTEGER NOT NULL,
  er_bp          INTEGER NOT NULL,
  cap_cents      INTEGER NOT NULL, -- compensation counted up to this
  source         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES users(id)
) STRICT;
-- Withholding tax on compensation (RR 11-2018 Annex E): one row per bracket; tax = base + rate × (taxable − over).
CREATE TABLE pay_wtax_brackets (
  id             INTEGER PRIMARY KEY,
  effective_from TEXT NOT NULL,
  frequency      TEXT NOT NULL CHECK (frequency IN ('weekly','semi_monthly','monthly')),
  over_cents     INTEGER NOT NULL,
  base_cents     INTEGER NOT NULL,
  rate_bp        INTEGER NOT NULL,
  source         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES users(id),
  UNIQUE (effective_from, frequency, over_cents)
) STRICT;
-- Pay rules: the daily minimum wage (Silang, Cavite), day multipliers (DOLE), the 13th-month accrual (ACC-18) and the
-- minimum net pay left after cash-advance deductions (OWN-09).
CREATE TABLE pay_rules (
  id                     INTEGER PRIMARY KEY,
  effective_from         TEXT NOT NULL,
  minimum_wage_cents     INTEGER NOT NULL,
  reg_holiday_off_bp     INTEGER NOT NULL,
  reg_holiday_worked_bp  INTEGER NOT NULL,
  reg_holiday_rest_bp    INTEGER NOT NULL,
  special_worked_bp      INTEGER NOT NULL,
  special_rest_bp        INTEGER NOT NULL,
  rest_day_worked_bp     INTEGER NOT NULL,
  ot_ordinary_bp         INTEGER NOT NULL, -- of the hourly rate on an ordinary day
  ot_premium_bp          INTEGER NOT NULL, -- of the hourly rate of a holiday or rest day
  accrue_13th            INTEGER NOT NULL CHECK (accrue_13th IN (0,1)),
  min_net_pay_cents      INTEGER NOT NULL CHECK (min_net_pay_cents >= 0),
  source                 TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  created_by             TEXT REFERENCES users(id)
) STRICT;

CREATE TRIGGER pay_sss_rates_no_update BEFORE UPDATE ON pay_sss_rates BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a new rate is a new row from its date'); END;
CREATE TRIGGER pay_phic_rates_no_update BEFORE UPDATE ON pay_phic_rates BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a new rate is a new row from its date'); END;
CREATE TRIGGER pay_hdmf_rates_no_update BEFORE UPDATE ON pay_hdmf_rates BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a new rate is a new row from its date'); END;
CREATE TRIGGER pay_wtax_brackets_no_update BEFORE UPDATE ON pay_wtax_brackets BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a new table is new rows from its date'); END;
CREATE TRIGGER pay_rules_no_update BEFORE UPDATE ON pay_rules BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: new rules are a new row from their date'); END;

-- Values in force in September 2026 (PLAN F1).
INSERT INTO pay_sss_rates (effective_from, msc_min_cents, msc_max_cents, msc_step_cents, regular_max_cents, ee_bp, er_bp, ec_low_cents, ec_high_cents, ec_low_max_msc_cents, source, created_at)
  VALUES ('2025-01-01', 500000, 3500000, 50000, 2000000, 500, 1000, 1000, 3000, 1450000, 'SSS Circular 2024-006 (PLAN F1)', '2026-09-28T00:00:00.000+08:00');
INSERT INTO pay_phic_rates (effective_from, rate_bp, floor_cents, ceiling_cents, days_6, days_5, source, created_at)
  VALUES ('2025-01-01', 500, 1000000, 10000000, 313, 261, 'PhilHealth Advisory 2025-0002; Circular 2018-0001 (PLAN F1)', '2026-09-28T00:00:00.000+08:00');
INSERT INTO pay_hdmf_rates (effective_from, ee_bp, ee_low_bp, low_max_cents, er_bp, cap_cents, source, created_at)
  VALUES ('2024-02-01', 200, 100, 150000, 200, 1000000, 'HDMF Circular 460 (PLAN F1)', '2026-09-28T00:00:00.000+08:00');
INSERT INTO pay_wtax_brackets (effective_from, frequency, over_cents, base_cents, rate_bp, source, created_at) VALUES
  ('2023-01-01', 'weekly',            0,        0,    0, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'weekly',       480800,        0, 1500, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'weekly',       769200,    43260, 2000, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'weekly',      1538500,   197120, 2500, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'weekly',      3846200,   774045, 3000, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'weekly',     15384600,  4235565, 3500, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'semi_monthly',      0,        0,    0, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'semi_monthly', 1041700,       0, 1500, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'semi_monthly', 1666700,   93750, 2000, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'semi_monthly', 3333300,  427070, 2500, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'semi_monthly', 8333300, 1677070, 3000, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'semi_monthly',33333300, 9177070, 3500, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'monthly',           0,        0,    0, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'monthly',     2083300,        0, 1500, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'monthly',     3333300,   187500, 2000, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'monthly',     6666700,   854180, 2500, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'monthly',    16666700,  3354180, 3000, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01', 'monthly',    66666700, 18354180, 3500, 'RR 11-2018 Annex E (2023 onward)', '2026-09-28T00:00:00.000+08:00');
INSERT INTO pay_rules (effective_from, minimum_wage_cents, reg_holiday_off_bp, reg_holiday_worked_bp, reg_holiday_rest_bp, special_worked_bp, special_rest_bp,
  rest_day_worked_bp, ot_ordinary_bp, ot_premium_bp, accrue_13th, min_net_pay_cents, source, created_at)
  VALUES ('2025-10-05', 55000, 10000, 20000, 26000, 13000, 15000, 13000, 12500, 13000, 1, 0,
    'Wage Order IVA-22 (Silang, OWN-06); DOLE LA 12-25; ACC-18 accrue; OWN-09 minimum net ₱0 (PLAN F1)', '2026-09-28T00:00:00.000+08:00');

-- Payroll run (PAY-): one pay group and period (F2); unique per group and period among recorded runs (checked on post).
CREATE TABLE pay_runs (
  document_id        TEXT PRIMARY KEY REFERENCES documents(id),
  pay_group          TEXT NOT NULL CHECK (pay_group IN ('WEEKLY_PIECE','SEMI_DAILY','SEMI_MONTHLY')),
  period_start       TEXT NOT NULL,
  period_end         TEXT NOT NULL,
  contribution_month TEXT NOT NULL, -- YYYY-MM of period_end (F3 M)
  tax_frequency      TEXT NOT NULL CHECK (tax_frequency IN ('weekly','semi_monthly')),
  gross_cents        INTEGER NOT NULL,
  net_cents          INTEGER NOT NULL,
  CHECK (period_end >= period_start)
) STRICT;
CREATE INDEX pay_runs_period ON pay_runs(pay_group, period_start);

-- One row per employee per run: the payslip's deductions and totals. Statutory columns are what this run took for
-- the contribution month (the month-to-date true-up, F3); *_due is the month's full share, for the carried shortfall.
CREATE TABLE pay_run_employees (
  id                TEXT PRIMARY KEY,
  document_id       TEXT NOT NULL REFERENCES pay_runs(document_id),
  employee_id       TEXT NOT NULL,
  employee_code     TEXT NOT NULL,
  employee_name     TEXT NOT NULL,
  cost_centre       TEXT NOT NULL CHECK (cost_centre IN ('production','office')),
  pay_type          TEXT NOT NULL,
  is_mwe            INTEGER NOT NULL CHECK (is_mwe IN (0,1)),
  gross_cents       INTEGER NOT NULL,
  piece_cents       INTEGER NOT NULL,
  taxable_cents     INTEGER NOT NULL,
  sss_msc_cents     INTEGER NOT NULL,
  sss_ee_cents      INTEGER NOT NULL CHECK (sss_ee_cents >= 0),
  sss_er_cents      INTEGER NOT NULL CHECK (sss_er_cents >= 0),
  sss_ec_cents      INTEGER NOT NULL CHECK (sss_ec_cents >= 0),
  phic_basis_cents  INTEGER NOT NULL,
  phic_ee_cents     INTEGER NOT NULL CHECK (phic_ee_cents >= 0),
  phic_er_cents     INTEGER NOT NULL CHECK (phic_er_cents >= 0),
  hdmf_ee_cents     INTEGER NOT NULL CHECK (hdmf_ee_cents >= 0),
  hdmf_er_cents     INTEGER NOT NULL CHECK (hdmf_er_cents >= 0),
  ee_short_cents    INTEGER NOT NULL CHECK (ee_short_cents >= 0), -- employee shares the pay could not cover (carried)
  wtax_cents        INTEGER NOT NULL CHECK (wtax_cents >= 0),
  ca_cents          INTEGER NOT NULL CHECK (ca_cents >= 0),
  ca_override_cents INTEGER CHECK (ca_override_cents >= 0), -- the deduction typed for this run; NULL = the plan
  thirteenth_cents  INTEGER NOT NULL CHECK (thirteenth_cents >= 0),
  net_cents         INTEGER NOT NULL CHECK (net_cents >= 0),
  UNIQUE (document_id, employee_id),
  CHECK (net_cents = gross_cents - sss_ee_cents - phic_ee_cents - hdmf_ee_cents - wtax_cents - ca_cents)
) STRICT;
CREATE INDEX pay_run_employees_emp ON pay_run_employees(employee_id);

-- Earning lines. qty is days × 1000 (basic, leave, holiday, rest day, absence), minutes (overtime) or pieces (piece).
-- A piece line pays one production assignment: its id is that row's prd_assignments.pay_run_line_id (paid once, F3).
CREATE TABLE pay_run_lines (
  id                TEXT PRIMARY KEY,
  run_employee_id   TEXT NOT NULL REFERENCES pay_run_employees(id),
  line_no           INTEGER NOT NULL CHECK (line_no >= 1),
  kind              TEXT NOT NULL CHECK (kind IN ('basic','leave','holiday','rest_day','ot','salary','absence','piece','allowance','adjustment')),
  description       TEXT NOT NULL,
  qty               INTEGER NOT NULL,
  rate_cents        INTEGER NOT NULL,
  multiplier_bp     INTEGER NOT NULL,
  amount_cents      INTEGER NOT NULL,
  taxable           INTEGER NOT NULL CHECK (taxable IN (0,1)),
  thirteenth_base   INTEGER NOT NULL CHECK (thirteenth_base IN (0,1)),
  assignment_id     TEXT,         -- piece lines (paid once is PRD's unique pay_run_line_id; a cancelled run's lines stay)
  job_order_id      TEXT REFERENCES documents(id),
  reason            TEXT,         -- manual lines
  UNIQUE (run_employee_id, line_no),
  CHECK ((kind = 'piece') = (assignment_id IS NOT NULL)),
  CHECK ((kind IN ('allowance','adjustment')) = (reason IS NOT NULL))
) STRICT;

-- Employees left out of a run on purpose, with why (their piece work stays unpaid for a later run).
CREATE TABLE pay_run_skips (
  document_id TEXT NOT NULL REFERENCES pay_runs(document_id),
  employee_id TEXT NOT NULL,
  reason      TEXT NOT NULL,
  PRIMARY KEY (document_id, employee_id)
) STRICT;

-- Payroll release (POUT-): pays out net pay of one run, for some or all of its employees, split across cash places.
CREATE TABLE pay_releases (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  run_id      TEXT NOT NULL REFERENCES pay_runs(document_id),
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  note        TEXT
) STRICT;
CREATE TABLE pay_release_lines (
  document_id  TEXT NOT NULL REFERENCES pay_releases(document_id),
  employee_id  TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (document_id, employee_id)
) STRICT;
CREATE TABLE pay_release_tenders (
  document_id     TEXT NOT NULL REFERENCES pay_releases(document_id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  reference       TEXT,
  PRIMARY KEY (document_id, line_no)
) STRICT;

CREATE TRIGGER pay_runs_no_update BEFORE UPDATE ON pay_runs BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;
CREATE TRIGGER pay_run_employees_no_update BEFORE UPDATE ON pay_run_employees BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;
CREATE TRIGGER pay_run_lines_no_update BEFORE UPDATE ON pay_run_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;
CREATE TRIGGER pay_run_skips_no_update BEFORE UPDATE ON pay_run_skips BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;
CREATE TRIGGER pay_releases_no_update BEFORE UPDATE ON pay_releases BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded releases are cancelled, never edited'); END;
CREATE TRIGGER pay_release_lines_no_update BEFORE UPDATE ON pay_release_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded releases are cancelled, never edited'); END;
CREATE TRIGGER pay_release_tenders_no_update BEFORE UPDATE ON pay_release_tenders BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded releases are cancelled, never edited'); END;
