-- Final pay on separation, unused service incentive leave paid in cash, and the 13th-month pay of one separated
-- employee (PLAN E11, F1 SIL, F3 "final run of year / separation"; Labor Code Art. 95; RR 11-2018 de minimis).

-- "Pay unused leave": ticked by the accountant on a run whose period ends in December; each employee's unused SIL days
-- of the year are paid on it. A final pay pays them without the tick.
ALTER TABLE pay_runs ADD COLUMN unused_leave INTEGER NOT NULL DEFAULT 0 CHECK (unused_leave IN (0,1));

-- The run lines that pay unused SIL in cash. pay_run_lines.kind keeps its 0001 list, so these lines are stored as
-- 'leave' (days × 1000 at the daily rate) with thirteenth_base 0; this row tells them apart from days of leave taken.
-- taxable 0 on the line is the de minimis part (up to 10 days a year), taxable 1 the part above it.
CREATE TABLE pay_run_unused_leave (
  run_line_id TEXT PRIMARY KEY REFERENCES pay_run_lines(id),
  year        INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100)
) STRICT;
CREATE TRIGGER pay_run_unused_leave_no_update BEFORE UPDATE ON pay_run_unused_leave BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;

-- An employee separated within a run's period: that run is their final pay (unused leave, the year-end tax adjustment,
-- the whole cash advance as far as the pay allows). What was left owed when it was recorded, for the payslip.
CREATE TABLE pay_run_final (
  run_employee_id  TEXT PRIMARY KEY REFERENCES pay_run_employees(id),
  separated_on     TEXT NOT NULL,
  ca_left_cents    INTEGER NOT NULL CHECK (ca_left_cents >= 0),    -- cash advances still owed after it
  loans_left_cents INTEGER NOT NULL CHECK (loans_left_cents >= 0)  -- SSS and Pag-IBIG loans still owed (not deducted)
) STRICT;
CREATE TRIGGER pay_run_final_no_update BEFORE UPDATE ON pay_run_final BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;

-- A 13th-month pay may be for one separated employee alone (their pay on separation, PD 851); NULL = the whole group.
ALTER TABLE pay_thirteenths ADD COLUMN separated_employee_id TEXT REFERENCES emp_employees(id);
