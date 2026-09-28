-- What payroll (PAY) marks on attendance and leave (PLAN E11, F3), written only through EMP/public.ts when a payroll run
-- is recorded. A row counts while its document stands (documents.status = 'posted'): cancelling the run unlocks the
-- days and gives the leave back without changing a row. Insert-only.

-- The days of one employee a recorded payroll run paid (their service within its period). Attendance on them is locked.
CREATE TABLE emp_paid_days (
  document_id TEXT NOT NULL REFERENCES documents(id),
  employee_id TEXT NOT NULL REFERENCES emp_employees(id),
  from_date   TEXT NOT NULL,
  to_date     TEXT NOT NULL,
  PRIMARY KEY (document_id, employee_id),
  CHECK (to_date >= from_date)
) STRICT;
CREATE INDEX emp_paid_days_employee ON emp_paid_days(employee_id, to_date);
CREATE TRIGGER emp_paid_days_no_update BEFORE UPDATE ON emp_paid_days
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;

-- Unused service incentive leave of a year paid in cash by a recorded payroll run (final pay, or the December run with
-- "Pay unused leave"): those days of the year are used up, like days of leave taken.
CREATE TABLE emp_sil_paid (
  document_id TEXT NOT NULL REFERENCES documents(id),
  employee_id TEXT NOT NULL REFERENCES emp_employees(id),
  year        INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  days        INTEGER NOT NULL CHECK (days > 0),
  PRIMARY KEY (document_id, employee_id, year)
) STRICT;
CREATE INDEX emp_sil_paid_employee ON emp_sil_paid(employee_id, year);
CREATE TRIGGER emp_sil_paid_no_update BEFORE UPDATE ON emp_sil_paid
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;
