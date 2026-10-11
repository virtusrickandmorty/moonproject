-- migrate: rebuild-with-foreign-keys-off
-- The weekly daily-paid group WEEKLY_DAILY (the owner's decision, Oct 9, 2026; EMP 0008) in payroll runs and 13th-month
-- pay: their CHECK on the group is widened by copying each table (same rows; the tables that point to them keep pointing
-- to the copy, checked by the migration runner), and their indexes and triggers are made again.
CREATE TABLE pay_runs_next (
  document_id        TEXT PRIMARY KEY REFERENCES documents(id),
  pay_group          TEXT NOT NULL CHECK (pay_group IN ('WEEKLY_PIECE','WEEKLY_DAILY','SEMI_DAILY','SEMI_MONTHLY')),
  period_start       TEXT NOT NULL,
  period_end         TEXT NOT NULL,
  contribution_month TEXT NOT NULL, -- YYYY-MM of period_end (F3 M)
  tax_frequency      TEXT NOT NULL CHECK (tax_frequency IN ('weekly','semi_monthly')),
  gross_cents        INTEGER NOT NULL,
  net_cents          INTEGER NOT NULL,
  year_end           INTEGER NOT NULL DEFAULT 0 CHECK (year_end IN (0,1)),
  unused_leave       INTEGER NOT NULL DEFAULT 0 CHECK (unused_leave IN (0,1)),
  CHECK (period_end >= period_start)
) STRICT;
INSERT INTO pay_runs_next (document_id, pay_group, period_start, period_end, contribution_month, tax_frequency, gross_cents, net_cents, year_end, unused_leave)
SELECT document_id, pay_group, period_start, period_end, contribution_month, tax_frequency, gross_cents, net_cents, year_end, unused_leave FROM pay_runs;
DROP TABLE pay_runs;
ALTER TABLE pay_runs_next RENAME TO pay_runs;
CREATE INDEX pay_runs_period ON pay_runs(pay_group, period_start);
CREATE TRIGGER pay_runs_no_update BEFORE UPDATE ON pay_runs BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;

CREATE TABLE pay_thirteenths_next (
  document_id           TEXT PRIMARY KEY REFERENCES documents(id),
  pay_group             TEXT NOT NULL CHECK (pay_group IN ('WEEKLY_PIECE','WEEKLY_DAILY','SEMI_DAILY','SEMI_MONTHLY')),
  year                  INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  total_cents           INTEGER NOT NULL CHECK (total_cents >= 0),
  net_cents             INTEGER NOT NULL CHECK (net_cents >= 0),
  separated_employee_id TEXT REFERENCES emp_employees(id)
) STRICT;
INSERT INTO pay_thirteenths_next (document_id, pay_group, year, total_cents, net_cents, separated_employee_id)
SELECT document_id, pay_group, year, total_cents, net_cents, separated_employee_id FROM pay_thirteenths;
DROP TABLE pay_thirteenths;
ALTER TABLE pay_thirteenths_next RENAME TO pay_thirteenths;
CREATE INDEX pay_thirteenths_group_year ON pay_thirteenths(pay_group, year);
CREATE TRIGGER pay_thirteenths_no_update BEFORE UPDATE ON pay_thirteenths BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded 13th-month pay is cancelled, never edited'); END;
