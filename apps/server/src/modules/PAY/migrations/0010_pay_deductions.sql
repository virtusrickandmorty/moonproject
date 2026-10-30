-- Other deductions typed on a payroll run (the owner's request, Oct 2026): an amount and what it is for, taken off the
-- pay after tax, contributions, loans, the cash advance and damage charges, never below the minimum net pay (all of the
-- pay on a final pay). Each goes to other income (a uniform, the canteen) or to money owed to the shop, paid back.
-- Like the loans and charges, kept apart from net_cents: NET PAY of a run line is
-- net_cents - loan_cents - charge_cents - deduction_cents + wtax_refund_cents.
ALTER TABLE pay_run_employees ADD COLUMN deduction_cents INTEGER NOT NULL DEFAULT 0
  CHECK (deduction_cents >= 0 AND loan_cents + charge_cents + deduction_cents <= net_cents);

-- Each deduction typed, what was asked and what the pay allowed. Insert-only, like the run.
CREATE TABLE pay_run_deductions (
  run_employee_id TEXT NOT NULL REFERENCES pay_run_employees(id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  goes_to         TEXT NOT NULL CHECK (goes_to IN ('other_income', 'owed_to_shop')),
  reason          TEXT NOT NULL CHECK (length(reason) BETWEEN 5 AND 200),
  wanted_cents    INTEGER NOT NULL CHECK (wanted_cents > 0),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= wanted_cents),
  PRIMARY KEY (run_employee_id, line_no)
) STRICT;
CREATE TRIGGER pay_run_deductions_no_update BEFORE UPDATE ON pay_run_deductions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payroll runs are cancelled, never edited'); END;
