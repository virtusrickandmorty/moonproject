-- Damage or loss charges taken back by payroll (the owner's request, Oct 2026; CA ca_charges): after tax, contributions,
-- loans and the cash advance, at most 20% of the employee's pay of the run. Like the loans (0003), the charges are kept
-- apart from net_cents, so NET PAY of a run line is net_cents - loan_cents - charge_cents + wtax_refund_cents.
ALTER TABLE pay_run_employees ADD COLUMN charge_cents INTEGER NOT NULL DEFAULT 0 CHECK (charge_cents >= 0 AND loan_cents + charge_cents <= net_cents);

-- Which charges a run took back, and how much of each was left after it. Insert-only, like the run.
CREATE TABLE pay_run_charges (
  run_employee_id  TEXT NOT NULL REFERENCES pay_run_employees(id),
  charge_id        TEXT NOT NULL REFERENCES documents(id),
  charge_number    TEXT NOT NULL,
  what             TEXT NOT NULL,
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  left_after_cents INTEGER NOT NULL CHECK (left_after_cents >= 0),
  PRIMARY KEY (run_employee_id, charge_id)
) STRICT;
CREATE INDEX pay_run_charges_charge ON pay_run_charges(charge_id);
CREATE TRIGGER pay_run_charges_no_update BEFORE UPDATE ON pay_run_charges
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payroll runs are cancelled, never edited'); END;
