-- Rework sent back (the owner's request, Oct 2026): pieces found needing rework go back to a step they already went
-- through. The pieces done there stay recorded (not replaced); the send-back is labelled rework on that step until rework
-- (pasubra) pieces are recorded there. With a wearer list, it names the wearers sent back. Insert-only.
CREATE TABLE prd_reworks (
  id           TEXT PRIMARY KEY,
  job_order_id TEXT NOT NULL REFERENCES documents(id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  step_id      INTEGER NOT NULL REFERENCES prd_steps(id),
  part         TEXT NOT NULL DEFAULT 'whole' CHECK (part IN ('whole', 'upper', 'lower')),
  pieces       INTEGER NOT NULL CHECK (pieces >= 1),
  reason       TEXT NOT NULL CHECK (length(reason) >= 10),
  at           TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX prd_reworks_line ON prd_reworks (job_order_id, line_no, step_id);

CREATE TABLE prd_rework_wearers (
  rework_id     TEXT NOT NULL REFERENCES prd_reworks(id),
  roster_row_no INTEGER NOT NULL CHECK (roster_row_no >= 1),
  PRIMARY KEY (rework_id, roster_row_no)
) STRICT;

CREATE TRIGGER prd_reworks_no_update BEFORE UPDATE ON prd_reworks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a rework send-back is kept as recorded'); END;
CREATE TRIGGER prd_reworks_no_delete BEFORE DELETE ON prd_reworks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a rework send-back is kept as recorded'); END;
CREATE TRIGGER prd_rework_wearers_no_update BEFORE UPDATE ON prd_rework_wearers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a rework send-back is kept as recorded'); END;
CREATE TRIGGER prd_rework_wearers_no_delete BEFORE DELETE ON prd_rework_wearers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a rework send-back is kept as recorded'); END;
