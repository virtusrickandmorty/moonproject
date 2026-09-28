-- 13th-month pay (TH13-, PLAN D5 TH13-PAY, E11, F1 "13th-month pay" and the ₱90,000 exemption), and its release (POUT-).

-- The yearly ceiling of tax-exempt 13th-month pay and other benefits (F1, RR 11-2018). Effective-dated and insert-only.
CREATE TABLE pay_benefit_ceilings (
  id             INTEGER PRIMARY KEY,
  effective_from TEXT NOT NULL,
  ceiling_cents  INTEGER NOT NULL CHECK (ceiling_cents >= 0),
  source         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES users(id)
) STRICT;
CREATE TRIGGER pay_benefit_ceilings_no_update BEFORE UPDATE ON pay_benefit_ceilings BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a new ceiling is a new row from its date'); END;
INSERT INTO pay_benefit_ceilings (effective_from, ceiling_cents, source, created_at)
  VALUES ('2018-01-01', 9000000, 'RR 11-2018: 13th-month pay and other benefits up to ₱90,000 a year are exempt (PLAN F1)', '2026-09-28T00:00:00.000+08:00');

-- The year's 13th-month pay of one pay group; one recorded per group and year (checked on post).
CREATE TABLE pay_thirteenths (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  pay_group   TEXT NOT NULL CHECK (pay_group IN ('WEEKLY_PIECE','SEMI_DAILY','SEMI_MONTHLY')),
  year        INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  net_cents   INTEGER NOT NULL CHECK (net_cents >= 0)
) STRICT;
CREATE INDEX pay_thirteenths_group_year ON pay_thirteenths(pay_group, year);

-- One row per employee paid: basic pay counted, one twelfth of it, what was accrued on 2111, what is paid, and the tax.
CREATE TABLE pay_thirteenth_employees (
  id                   TEXT PRIMARY KEY,
  document_id          TEXT NOT NULL REFERENCES pay_thirteenths(document_id),
  employee_id          TEXT NOT NULL,
  employee_code        TEXT NOT NULL,
  employee_name        TEXT NOT NULL,
  cost_centre          TEXT NOT NULL CHECK (cost_centre IN ('production','office')),
  basic_cents          INTEGER NOT NULL,            -- basic pay of the runs counted (thirteenth_base lines)
  earlier_basic_cents  INTEGER NOT NULL,            -- the part from runs of earlier years no 13th-month pay covered
  due_cents            INTEGER NOT NULL CHECK (due_cents >= 0),
  accrued_cents        INTEGER NOT NULL CHECK (accrued_cents >= 0),
  amount_cents         INTEGER NOT NULL CHECK (amount_cents >= 0),
  reason               TEXT,                        -- set when staff changed the amount
  other_benefits_cents INTEGER NOT NULL CHECK (other_benefits_cents >= 0),
  taxable_cents        INTEGER NOT NULL CHECK (taxable_cents >= 0),
  wtax_cents           INTEGER NOT NULL CHECK (wtax_cents >= 0),
  net_cents            INTEGER NOT NULL CHECK (net_cents >= 0),
  UNIQUE (document_id, employee_id),
  CHECK (net_cents = amount_cents - wtax_cents)
) STRICT;
CREATE INDEX pay_thirteenth_employees_emp ON pay_thirteenth_employees(employee_id);

-- The payroll-run rows whose basic pay a 13th-month pay counted, so no other one counts them again.
CREATE TABLE pay_thirteenth_basis (
  thirteenth_employee_id TEXT NOT NULL REFERENCES pay_thirteenth_employees(id),
  run_employee_id        TEXT NOT NULL REFERENCES pay_run_employees(id),
  PRIMARY KEY (thirteenth_employee_id, run_employee_id)
) STRICT;
CREATE INDEX pay_thirteenth_basis_run ON pay_thirteenth_basis(run_employee_id);

CREATE TABLE pay_thirteenth_skips (
  document_id TEXT NOT NULL REFERENCES pay_thirteenths(document_id),
  employee_id TEXT NOT NULL,
  reason      TEXT NOT NULL,
  PRIMARY KEY (document_id, employee_id)
) STRICT;

-- A payroll release (POUT-) of 13th-month net pay. pay_releases names a payroll run, so these rows name the TH13.
CREATE TABLE pay_thirteenth_releases (
  document_id   TEXT PRIMARY KEY REFERENCES documents(id),
  thirteenth_id TEXT NOT NULL REFERENCES pay_thirteenths(document_id),
  total_cents   INTEGER NOT NULL CHECK (total_cents > 0),
  note          TEXT
) STRICT;
CREATE TABLE pay_thirteenth_release_lines (
  document_id  TEXT NOT NULL REFERENCES pay_thirteenth_releases(document_id),
  employee_id  TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (document_id, employee_id)
) STRICT;
CREATE TABLE pay_thirteenth_release_tenders (
  document_id     TEXT NOT NULL REFERENCES pay_thirteenth_releases(document_id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  reference       TEXT,
  PRIMARY KEY (document_id, line_no)
) STRICT;

CREATE TRIGGER pay_thirteenths_no_update BEFORE UPDATE ON pay_thirteenths BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded 13th-month pay is cancelled, never edited'); END;
CREATE TRIGGER pay_thirteenth_employees_no_update BEFORE UPDATE ON pay_thirteenth_employees BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded 13th-month pay is cancelled, never edited'); END;
CREATE TRIGGER pay_thirteenth_basis_no_update BEFORE UPDATE ON pay_thirteenth_basis BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded 13th-month pay is cancelled, never edited'); END;
CREATE TRIGGER pay_thirteenth_skips_no_update BEFORE UPDATE ON pay_thirteenth_skips BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded 13th-month pay is cancelled, never edited'); END;
CREATE TRIGGER pay_thirteenth_releases_no_update BEFORE UPDATE ON pay_thirteenth_releases BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded releases are cancelled, never edited'); END;
CREATE TRIGGER pay_thirteenth_release_lines_no_update BEFORE UPDATE ON pay_thirteenth_release_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded releases are cancelled, never edited'); END;
CREATE TRIGGER pay_thirteenth_release_tenders_no_update BEFORE UPDATE ON pay_thirteenth_release_tenders BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded releases are cancelled, never edited'); END;
