-- Go-live decisions are insert-only. A later answer supersedes an earlier one without changing its history.
CREATE TABLE acc_go_live_answers (
  id          INTEGER PRIMARY KEY,
  decision_id TEXT NOT NULL,
  answer      TEXT NOT NULL CHECK (length(answer) BETWEEN 1 AND 1000),
  decided_by  TEXT NOT NULL CHECK (length(decided_by) BETWEEN 2 AND 120),
  decided_on  TEXT NOT NULL CHECK (decided_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  note        TEXT NOT NULL CHECK (length(note) <= 1000),
  recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX acc_go_live_answers_decision ON acc_go_live_answers(decision_id, id DESC);
CREATE TRIGGER acc_go_live_answers_no_update BEFORE UPDATE ON acc_go_live_answers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: record a new answer instead'); END;
