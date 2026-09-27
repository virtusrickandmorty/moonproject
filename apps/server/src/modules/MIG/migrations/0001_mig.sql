-- MIG module tables (prefix mig_).
-- STRICT tables with BEFORE DELETE abort triggers.

CREATE TABLE mig_uploads (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('staged', 'dry_run_passed', 'committed'))
) STRICT;

CREATE TRIGGER mig_uploads_no_delete BEFORE DELETE ON mig_uploads
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: migration uploads cannot be deleted'); END;


CREATE TABLE mig_rows (
  id                TEXT PRIMARY KEY,
  upload_id         TEXT NOT NULL REFERENCES mig_uploads(id),
  row_number        INTEGER NOT NULL,
  raw_json          TEXT NOT NULL, -- The original CSV row parsed as JSON
  row_type          TEXT NOT NULL CHECK (row_type IN ('customer', 'measurement', 'employee', 'unknown')),
  status            TEXT NOT NULL CHECK (status IN ('valid', 'needs_review', 'accepted', 'excluded')),
  issues_json       TEXT NOT NULL, -- JSON array of issue strings, e.g. ["Missing name", "Rate requires confirmation"]
  manual_data_json  TEXT,          -- User-provided overrides (e.g. assigning a customer to a MANUAL measurement)
  created_at        TEXT NOT NULL,
  resolved_by       TEXT,
  resolved_at       TEXT
) STRICT;

CREATE TRIGGER mig_rows_no_delete BEFORE DELETE ON mig_rows
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: migration rows cannot be deleted'); END;
