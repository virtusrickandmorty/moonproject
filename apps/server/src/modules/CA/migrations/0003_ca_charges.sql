-- Damage or loss charge (DMG-; the owner's request, Oct 2026): an employee is charged for something damaged or lost, and
-- it is taken back through payroll an instalment at a time, after tax and contributions, never more than 20% of the pay of
-- a payroll (Labor Code Art. 113-114 and its rules: responsibility shown, the employee heard, a fair amount no more than
-- the loss). Booked as owed by the employee (1290, party employee) and recovered (7103); what is still owed is read from
-- the ledger. Insert-only: a mistake is cancelled.
CREATE TABLE ca_charges (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  employee_id       TEXT NOT NULL,
  employee_name     TEXT NOT NULL,
  what              TEXT NOT NULL CHECK (length(what) BETWEEN 3 AND 200), -- what was damaged or lost
  job_order_id      TEXT REFERENCES documents(id),                         -- the job it happened on, if any
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  installment_cents INTEGER NOT NULL CHECK (installment_cents > 0 AND installment_cents <= amount_cents),
  explanation       TEXT NOT NULL CHECK (length(explanation) >= 10),      -- the employee's side, heard before charging
  note              TEXT
) STRICT;
CREATE INDEX ca_charges_employee ON ca_charges(employee_id);
CREATE TRIGGER ca_charges_no_update BEFORE UPDATE ON ca_charges
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded charges are cancelled, never edited'); END;
