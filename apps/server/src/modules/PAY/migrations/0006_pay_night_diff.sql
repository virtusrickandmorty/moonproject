-- Night differential (PLAN F1, Labor Code Art. 86): 10% of the hourly rate for each hour worked between 10 PM and 6 AM,
-- of the day's rate (a holiday's or rest day's premium rate on those days). An effective-dated rule like the others;
-- rows from before this column get the 10% in force.
ALTER TABLE pay_rules ADD COLUMN night_diff_bp INTEGER NOT NULL DEFAULT 1000 CHECK (night_diff_bp >= 0);

-- The run lines that pay night differential. pay_run_lines.kind keeps its 0001 list, so these lines are stored as 'ot'
-- (qty in minutes, like overtime) and this row tells them apart; for an MWE they are exempt like overtime (RR 11-2018).
CREATE TABLE pay_run_night_diff (
  run_line_id TEXT PRIMARY KEY REFERENCES pay_run_lines(id)
) STRICT;
CREATE TRIGGER pay_run_night_diff_no_update BEFORE UPDATE ON pay_run_night_diff BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payrolls are cancelled, never edited'); END;
