-- AUD nightly checks (PLAN E13 "Integrity centre ... nightly"): what each night's run found. One run per night; a run
-- after a night the PC was off covers every day since the last run (covers_from .. night). Append-only. Rows are never
-- deleted (NR-3); the Nightly checks screen lists the last 400 nights.
CREATE TABLE aud_nightly_runs (
  id          TEXT PRIMARY KEY,
  night       TEXT NOT NULL UNIQUE,   -- the last Manila business date the run covers (the day that just ended)
  covers_from TEXT NOT NULL,          -- the first date the day checks cover (= night on a normal night)
  ran_at      TEXT NOT NULL,          -- Manila timestamp
  found_count INTEGER NOT NULL CHECK (found_count >= 0),
  CHECK (covers_from <= night)
) STRICT;
CREATE INDEX aud_nightly_runs_night ON aud_nightly_runs(night);

-- One row per check per run: passed, or found (found_count things to look at).
CREATE TABLE aud_nightly_checks (
  run_id      TEXT NOT NULL REFERENCES aud_nightly_runs(id),
  check_key   TEXT NOT NULL,
  passed      INTEGER NOT NULL CHECK (passed IN (0, 1)),
  found_count INTEGER NOT NULL CHECK (found_count >= 0),
  PRIMARY KEY (run_id, check_key),
  CHECK ((passed = 1) = (found_count = 0))
) STRICT;

-- What a check found: plain English, and where to look (a document or a report), when there is a place.
CREATE TABLE aud_nightly_findings (
  run_id    TEXT NOT NULL REFERENCES aud_nightly_runs(id),
  check_key TEXT NOT NULL,
  seq       INTEGER NOT NULL CHECK (seq >= 1),
  detail    TEXT NOT NULL,
  path      TEXT,
  PRIMARY KEY (run_id, check_key, seq)
) STRICT;

CREATE TRIGGER aud_nightly_runs_no_update BEFORE UPDATE ON aud_nightly_runs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a night''s results are never edited'); END;
CREATE TRIGGER aud_nightly_checks_no_update BEFORE UPDATE ON aud_nightly_checks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a night''s results are never edited'); END;
CREATE TRIGGER aud_nightly_findings_no_update BEFORE UPDATE ON aud_nightly_findings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a night''s results are never edited'); END;
