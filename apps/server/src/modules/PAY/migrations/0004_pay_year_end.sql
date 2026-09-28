-- Year-end tax adjustment, pay before Moonproject, and the 2316 / 1604-C data (PLAN F3 "final run of year: year-end
-- adjustment", F4 "2316 data and 1604-C alphalist", D8 "Yearly"; BIR RR 11-2018, RMC 21-2010).

-- The annual tax table on compensation (NIRC Sec. 24(A)(2) as amended by TRAIN; RR 11-2018): tax = base + rate ×
-- (annual taxable − over). Effective-dated and insert-only, like the withholding tables; a year uses the version in
-- force on its 31 December.
CREATE TABLE pay_wtax_annual (
  id             INTEGER PRIMARY KEY,
  effective_from TEXT NOT NULL,
  over_cents     INTEGER NOT NULL CHECK (over_cents >= 0),
  base_cents     INTEGER NOT NULL CHECK (base_cents >= 0),
  rate_bp        INTEGER NOT NULL CHECK (rate_bp >= 0),
  source         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES users(id),
  UNIQUE (effective_from, over_cents)
) STRICT;
CREATE TRIGGER pay_wtax_annual_no_update BEFORE UPDATE ON pay_wtax_annual BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a new table is new rows from its date'); END;
INSERT INTO pay_wtax_annual (effective_from, over_cents, base_cents, rate_bp, source, created_at) VALUES
  ('2018-01-01',          0,         0,    0, 'RR 11-2018 annual table (2018–2022)', '2026-09-28T00:00:00.000+08:00'),
  ('2018-01-01',   25000000,         0, 2000, 'RR 11-2018 annual table (2018–2022)', '2026-09-28T00:00:00.000+08:00'),
  ('2018-01-01',   40000000,   3000000, 2500, 'RR 11-2018 annual table (2018–2022)', '2026-09-28T00:00:00.000+08:00'),
  ('2018-01-01',   80000000,  13000000, 3000, 'RR 11-2018 annual table (2018–2022)', '2026-09-28T00:00:00.000+08:00'),
  ('2018-01-01',  200000000,  49000000, 3200, 'RR 11-2018 annual table (2018–2022)', '2026-09-28T00:00:00.000+08:00'),
  ('2018-01-01',  800000000, 241000000, 3500, 'RR 11-2018 annual table (2018–2022)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01',          0,         0,    0, 'RR 11-2018 annual table (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01',   25000000,         0, 1500, 'RR 11-2018 annual table (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01',   40000000,   2250000, 2000, 'RR 11-2018 annual table (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01',   80000000,  10250000, 2500, 'RR 11-2018 annual table (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01',  200000000,  40250000, 3000, 'RR 11-2018 annual table (2023 onward)', '2026-09-28T00:00:00.000+08:00'),
  ('2023-01-01',  800000000, 220250000, 3500, 'RR 11-2018 annual table (2023 onward)', '2026-09-28T00:00:00.000+08:00');

-- Pay before Moonproject: per employee and year, what this shop paid and withheld before it used Moonproject
-- ('before'), and what a previous employer paid and withheld this year, from its 2316 ('previous'). Master data:
-- changed in place with If-Match and an audit row, never deleted (a wrong row is changed to zeros). The parts add up to
-- the gross, as on the 2316: benefits_cents is the exempt 13th-month pay and other benefits (item 34), taxable_cents
-- the taxable compensation after the employee's shares and the exempt benefits (item 52, or item 22 of a new employer).
CREATE TABLE pay_prior_pay (
  id                 TEXT PRIMARY KEY,
  employee_id        TEXT NOT NULL REFERENCES emp_employees(id),
  year               INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  source             TEXT NOT NULL CHECK (source IN ('before','previous')),
  employer_name      TEXT,                   -- previous employer only
  employer_tin       TEXT,
  gross_cents        INTEGER NOT NULL CHECK (gross_cents >= 0),
  benefits_cents     INTEGER NOT NULL CHECK (benefits_cents >= 0),
  de_minimis_cents   INTEGER NOT NULL CHECK (de_minimis_cents >= 0),
  sss_cents          INTEGER NOT NULL CHECK (sss_cents >= 0),
  phic_cents         INTEGER NOT NULL CHECK (phic_cents >= 0),
  hdmf_cents         INTEGER NOT NULL CHECK (hdmf_cents >= 0),
  other_nontax_cents INTEGER NOT NULL CHECK (other_nontax_cents >= 0),
  taxable_cents      INTEGER NOT NULL CHECK (taxable_cents >= 0),
  wtax_cents         INTEGER NOT NULL CHECK (wtax_cents >= 0),
  note               TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  updated_at         TEXT NOT NULL,
  UNIQUE (employee_id, year, source),
  CHECK (gross_cents = benefits_cents + de_minimis_cents + sss_cents + phic_cents + hdmf_cents + other_nontax_cents + taxable_cents),
  CHECK (source = 'previous' OR (employer_name IS NULL AND employer_tin IS NULL))
) STRICT;
CREATE TRIGGER pay_prior_pay_fixed BEFORE UPDATE OF id, employee_id, year, source, created_at, created_by ON pay_prior_pay
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: the employee, year and source of pay before Moonproject never change'); END;

-- A payroll run may carry the year-end tax adjustment of its employees (ticked by the accountant on a run whose period
-- ends in December). Its tax for each of them is the annual tax less what the year withheld before it; an excess is
-- refunded on the run (Dr 2310 / Cr 2110 per employee). pay_run_employees.net_cents keeps its 0001 meaning (gross less
-- shares, tax and cash advance), so NET PAY of a run line is net_cents - loan_cents + wtax_refund_cents.
ALTER TABLE pay_runs ADD COLUMN year_end INTEGER NOT NULL DEFAULT 0 CHECK (year_end IN (0,1));
ALTER TABLE pay_run_employees ADD COLUMN wtax_refund_cents INTEGER NOT NULL DEFAULT 0 CHECK (wtax_refund_cents >= 0);

-- The adjustment worked out for one employee of a year-end run, as it stood when recorded (the payslip and the 2316).
CREATE TABLE pay_run_year_end (
  run_employee_id        TEXT PRIMARY KEY REFERENCES pay_run_employees(id),
  year                   INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  taxable_cents          INTEGER NOT NULL,                              -- the year's taxable compensation, previous employer included
  benefits_taxable_cents INTEGER NOT NULL CHECK (benefits_taxable_cents >= 0), -- 13th-month pay and other benefits above the ceiling
  annual_tax_cents       INTEGER NOT NULL CHECK (annual_tax_cents >= 0),
  withheld_before_cents  INTEGER NOT NULL,                              -- withheld in the year before this run
  deficiency_cents       INTEGER NOT NULL CHECK (deficiency_cents >= 0), -- annual tax − withheld before, when more
  withheld_cents         INTEGER NOT NULL CHECK (withheld_cents >= 0),   -- the part withheld on this run (its tax)
  refund_cents           INTEGER NOT NULL CHECK (refund_cents >= 0),     -- withheld before − annual tax, when more
  CHECK (deficiency_cents = 0 OR refund_cents = 0),
  CHECK (withheld_cents <= deficiency_cents)
) STRICT;
CREATE INDEX pay_run_year_end_year ON pay_run_year_end(year);
CREATE TRIGGER pay_run_year_end_no_update BEFORE UPDATE ON pay_run_year_end BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;
