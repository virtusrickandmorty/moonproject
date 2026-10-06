-- A sheet typed twice is paid twice (audit B2-F3): a work row matching a recorded one (worker, job order, line, step,
-- work date and pieces) is kept only with a reason saying it is a different sheet. Payroll lists these rows.
CREATE TABLE prd_assignment_repeats (
  assignment_id TEXT PRIMARY KEY REFERENCES prd_assignments(id),
  reason        TEXT NOT NULL CHECK (length(reason) BETWEEN 5 AND 200)
) STRICT;
CREATE TRIGGER prd_assignment_repeats_no_update BEFORE UPDATE ON prd_assignment_repeats
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded pieces are corrected with a new entry, never edited'); END;
