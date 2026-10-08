-- Which wearers of a job order line a production row finished (the owner's request, Oct 2026): ticked on Record pieces,
-- so the next entry on that step knows who is done. One row per wearer (the job order's roster row). Insert-only, like
-- the assignment it belongs to; a cancelled entry's wearers no longer count as done (its document is not posted).
CREATE TABLE prd_assignment_wearers (
  assignment_id TEXT NOT NULL REFERENCES prd_assignments(id),
  roster_row_no INTEGER NOT NULL CHECK (roster_row_no >= 1),
  PRIMARY KEY (assignment_id, roster_row_no)
) STRICT;

CREATE TRIGGER prd_assignment_wearers_no_update BEFORE UPDATE ON prd_assignment_wearers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a production row''s wearers are kept as recorded'); END;
