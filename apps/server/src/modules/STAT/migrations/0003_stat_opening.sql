-- Opening Statutory Payable (OBST-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): what a contribution month on or before
-- the cut-over date left withheld and not yet remitted (SSS, PhilHealth, Pag-IBIG, withholding tax on compensation, and
-- any SSS or Pag-IBIG loan amortizations deducted and not yet remitted), per employee. Its journal credits 2401-2405 and
-- 2310 per employee tagged with the contribution month, exactly as a payroll run's; ledger.ts reads it alongside the
-- month's payroll runs, so the month's payable, the remittance check and a remittance (REM-) of that month see it.

CREATE TABLE stat_openings (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  month           TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'), -- the contribution month (PAY M)
  sss_cents       INTEGER NOT NULL DEFAULT 0 CHECK (sss_cents >= 0), -- SSS employee, employer and EC together (2401)
  phic_cents      INTEGER NOT NULL DEFAULT 0 CHECK (phic_cents >= 0), -- PhilHealth (2402)
  hdmf_cents      INTEGER NOT NULL DEFAULT 0 CHECK (hdmf_cents >= 0), -- Pag-IBIG (2403)
  wtax_cents      INTEGER NOT NULL DEFAULT 0 CHECK (wtax_cents >= 0), -- withholding tax on compensation (2310)
  sss_loan_cents  INTEGER NOT NULL DEFAULT 0 CHECK (sss_loan_cents >= 0), -- SSS loan amortizations (2404)
  hdmf_loan_cents INTEGER NOT NULL DEFAULT 0 CHECK (hdmf_loan_cents >= 0), -- Pag-IBIG loan amortizations (2405)
  total_cents     INTEGER NOT NULL CHECK (total_cents > 0)
) STRICT;
CREATE INDEX stat_openings_month ON stat_openings(month);

-- What is still to remit per employee (the variance behind the month total, and each employee's journal line).
CREATE TABLE stat_opening_lines (
  document_id     TEXT NOT NULL REFERENCES stat_openings(document_id),
  employee_id     TEXT NOT NULL,
  employee_name   TEXT NOT NULL, -- as it read when recorded
  sss_cents       INTEGER NOT NULL DEFAULT 0 CHECK (sss_cents >= 0),
  phic_cents      INTEGER NOT NULL DEFAULT 0 CHECK (phic_cents >= 0),
  hdmf_cents      INTEGER NOT NULL DEFAULT 0 CHECK (hdmf_cents >= 0),
  wtax_cents      INTEGER NOT NULL DEFAULT 0 CHECK (wtax_cents >= 0),
  sss_loan_cents  INTEGER NOT NULL DEFAULT 0 CHECK (sss_loan_cents >= 0),
  hdmf_loan_cents INTEGER NOT NULL DEFAULT 0 CHECK (hdmf_loan_cents >= 0),
  PRIMARY KEY (document_id, employee_id)
) STRICT;

CREATE TRIGGER stat_openings_no_update BEFORE UPDATE ON stat_openings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded opening statutory payables are cancelled, never edited'); END;
CREATE TRIGGER stat_opening_lines_no_update BEFORE UPDATE ON stat_opening_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded opening statutory payables are cancelled, never edited'); END;
