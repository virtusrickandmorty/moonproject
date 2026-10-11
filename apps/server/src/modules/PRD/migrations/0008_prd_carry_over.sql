-- Production carried over when a job order is edited (the owner's request, Oct 2026). An edit cancels the job order and
-- records a replacement; each item of the replacement that matches an item of the old one keeps its production: its route
-- and step status and rework are copied to it, and the pieces and wearers recorded on the old one (and on the ones before
-- it, when edited again) count on it through these links. The entries recorded stay as they are, so nothing is paid twice.
-- An item or wearer left out of the edit keeps its work on record as extras. Insert-only.
CREATE TABLE prd_carry_overs (
  job_order_id      TEXT NOT NULL REFERENCES documents(id),
  line_no           INTEGER NOT NULL CHECK (line_no >= 1),
  from_job_order_id TEXT NOT NULL REFERENCES documents(id),
  from_line_no      INTEGER NOT NULL CHECK (from_line_no >= 1),
  PRIMARY KEY (job_order_id, line_no, from_job_order_id, from_line_no)
) STRICT;
CREATE INDEX prd_carry_overs_from ON prd_carry_overs (from_job_order_id, from_line_no);

-- Which wearer of the old item each wearer of the new one is (roster row numbers).
CREATE TABLE prd_carry_over_wearers (
  job_order_id      TEXT NOT NULL,
  line_no           INTEGER NOT NULL,
  from_job_order_id TEXT NOT NULL,
  from_line_no      INTEGER NOT NULL,
  from_row_no       INTEGER NOT NULL CHECK (from_row_no >= 1),
  row_no            INTEGER NOT NULL CHECK (row_no >= 1),
  PRIMARY KEY (job_order_id, line_no, from_job_order_id, from_line_no, from_row_no),
  FOREIGN KEY (job_order_id, line_no, from_job_order_id, from_line_no) REFERENCES prd_carry_overs (job_order_id, line_no, from_job_order_id, from_line_no)
) STRICT;

CREATE TRIGGER prd_carry_overs_no_update BEFORE UPDATE ON prd_carry_overs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a carry-over is kept as recorded'); END;
CREATE TRIGGER prd_carry_overs_no_delete BEFORE DELETE ON prd_carry_overs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a carry-over is kept as recorded'); END;
CREATE TRIGGER prd_carry_over_wearers_no_update BEFORE UPDATE ON prd_carry_over_wearers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a carry-over is kept as recorded'); END;
CREATE TRIGGER prd_carry_over_wearers_no_delete BEFORE DELETE ON prd_carry_over_wearers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a carry-over is kept as recorded'); END;

-- The work rows of each job order line: its own, and those of the lines it was carried over from (jo, line = the line
-- they count on now).
CREATE VIEW prd_line_assignments AS
  SELECT a.*, a.job_order_id AS jo, a.line_no AS line FROM prd_assignments a
  UNION ALL
  SELECT a.*, c.job_order_id AS jo, c.line_no AS line FROM prd_assignments a
    JOIN prd_carry_overs c ON c.from_job_order_id = a.job_order_id AND c.from_line_no = a.line_no;

-- The wearers ticked on those rows, as roster rows of the line they count on now (a wearer left out is not carried).
CREATE VIEW prd_line_assignment_wearers AS
  SELECT w.assignment_id, a.job_order_id AS jo, a.line_no AS line, w.roster_row_no FROM prd_assignment_wearers w
    JOIN prd_assignments a ON a.id = w.assignment_id
  UNION ALL
  SELECT w.assignment_id, m.job_order_id AS jo, m.line_no AS line, m.row_no AS roster_row_no FROM prd_assignment_wearers w
    JOIN prd_assignments a ON a.id = w.assignment_id
    JOIN prd_carry_over_wearers m ON m.from_job_order_id = a.job_order_id AND m.from_line_no = a.line_no AND m.from_row_no = w.roster_row_no;
