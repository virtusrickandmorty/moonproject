-- Government loans (PLAN D5 PAY-RUN "2404/2405 loans", E11, F3 "government loans" after tax and before cash advances):
-- SSS salary and calamity loans and Pag-IBIG multi-purpose and calamity loans, deducted from pay once a month and owed to
-- the agency (Cr 2404 SSS loans / 2405 Pag-IBIG loans per employee, tagged with the month), then paid with the month's
-- contributions on the same remittance (STAT).

-- The register: one row per loan. Master data: changed in place with If-Match and an audit row, never deleted; a loan
-- paid off early is stopped from a month with a reason, and stays stopped. The employee, kind and agency never change.
CREATE TABLE pay_gov_loans (
  id                 TEXT PRIMARY KEY,
  employee_id        TEXT NOT NULL REFERENCES emp_employees(id),
  kind               TEXT NOT NULL CHECK (kind IN ('SSS_SALARY','SSS_CALAMITY','HDMF_MPL','HDMF_CALAMITY')),
  agency             TEXT NOT NULL CHECK (agency IN ('SSS','HDMF')),
  loan_no            TEXT NOT NULL,          -- the agency's loan number
  amortization_cents INTEGER NOT NULL CHECK (amortization_cents > 0),
  first_month        TEXT NOT NULL CHECK (first_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'), -- first month deducted
  last_month         TEXT NOT NULL CHECK (last_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),  -- last month deducted
  stopped_from       TEXT CHECK (stopped_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),         -- nothing deducted from this month on
  stop_reason        TEXT,
  note               TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  updated_at         TEXT NOT NULL,
  CHECK (last_month >= first_month),
  CHECK (agency = CASE WHEN kind LIKE 'SSS%' THEN 'SSS' ELSE 'HDMF' END),
  CHECK ((stopped_from IS NULL) = (stop_reason IS NULL))
) STRICT;
CREATE INDEX pay_gov_loans_employee ON pay_gov_loans(employee_id);
CREATE UNIQUE INDEX pay_gov_loans_number ON pay_gov_loans(agency, loan_no) WHERE stopped_from IS NULL;
CREATE TRIGGER pay_gov_loans_fixed BEFORE UPDATE OF id, employee_id, kind, agency, created_at, created_by ON pay_gov_loans
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a loan keeps its employee and kind; stop it and register the right one'); END;
CREATE TRIGGER pay_gov_loans_stopped BEFORE UPDATE ON pay_gov_loans WHEN OLD.stopped_from IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a stopped loan stays as it was'); END;

-- A run's loan deductions per employee and loan: what the plan (or the amount typed on the run, with its note) wanted,
-- what the net pay allowed, and what was left of the loan after it (the payslip).
CREATE TABLE pay_run_loans (
  run_employee_id     TEXT NOT NULL REFERENCES pay_run_employees(id),
  loan_id             TEXT NOT NULL REFERENCES pay_gov_loans(id),
  agency              TEXT NOT NULL CHECK (agency IN ('SSS','HDMF')),
  kind                TEXT NOT NULL,
  loan_no             TEXT NOT NULL,         -- as it read when recorded
  due_cents           INTEGER NOT NULL CHECK (due_cents >= 0),
  amount_cents        INTEGER NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= due_cents),
  override_cents      INTEGER CHECK (override_cents >= 0), -- typed on the run (0 = skipped this month); NULL = the plan
  reason              TEXT,
  balance_after_cents INTEGER NOT NULL CHECK (balance_after_cents >= 0),
  PRIMARY KEY (run_employee_id, loan_id),
  CHECK ((override_cents IS NULL) = (reason IS NULL)),
  CHECK (override_cents IS NULL OR due_cents = override_cents)
) STRICT;
CREATE INDEX pay_run_loans_loan ON pay_run_loans(loan_id);
CREATE TRIGGER pay_run_loans_no_update BEFORE UPDATE ON pay_run_loans BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;

-- The employee's government loan deductions of the run, in total. pay_run_employees.net_cents keeps its 0001 meaning
-- (gross less employee shares, tax and cash advance) because its CHECK cannot change in place; from here on the NET PAY
-- of a run line is net_cents - loan_cents, never below zero.
ALTER TABLE pay_run_employees ADD COLUMN loan_cents INTEGER NOT NULL DEFAULT 0 CHECK (loan_cents >= 0 AND loan_cents <= net_cents);
