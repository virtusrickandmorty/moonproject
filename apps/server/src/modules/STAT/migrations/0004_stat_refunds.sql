-- K23: year-end tax refunds in the withholding-tax remittance (PLAN F3, BIR RR 11-2018). A year-end payroll run refunds
-- over-withheld tax (Dr 2310 per employee, PAY/doctypes/run.ts), so an employee's 2310 for the month can be below zero.
-- A withholding-tax remittance (REM-, scheme WTAX) remits the month's net: it debits 2310 for the employees still owing
-- (stat_remittance_lines) and credits it for the year-end refunds it takes off. When an earlier month's refunds were
-- more than its tax withheld, that month had nothing to remit and the next month's remittance settles it: it debits
-- that month's employees still owing and credits its refunds. These are those lines, per month settled; ledger.ts reads
-- them to put each line of the remittance's journal in the month it settles.
CREATE TABLE stat_remittance_adjustments (
  document_id   TEXT NOT NULL REFERENCES stat_remittances(document_id),
  month         TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'), -- the month settled: the remittance's own, or an earlier one
  employee_id   TEXT NOT NULL,
  employee_name TEXT NOT NULL, -- as it read when recorded
  debit_cents   INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0), -- an earlier month's tax still owing, remitted with this one
  credit_cents  INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0), -- a year-end tax refund taken off
  CHECK ((debit_cents > 0) <> (credit_cents > 0)),
  PRIMARY KEY (document_id, month, employee_id)
) STRICT;
CREATE INDEX stat_remittance_adjustments_month ON stat_remittance_adjustments(month);

CREATE TRIGGER stat_remittance_adjustments_no_update BEFORE UPDATE ON stat_remittance_adjustments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded remittances are cancelled, never edited'); END;
