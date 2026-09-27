-- MIG module tables (prefix mig_).
-- STRICT tables with BEFORE DELETE abort triggers managed by engine for all tables.

CREATE TABLE mig_uploads (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('staged', 'dry_run_passed', 'committed'))
) STRICT;

CREATE TABLE mig_rows (
  id                TEXT PRIMARY KEY,
  upload_id         TEXT NOT NULL REFERENCES mig_uploads(id),
  row_number        INTEGER NOT NULL,
  raw_json          TEXT NOT NULL, -- The original CSV row parsed as JSON
  row_type          TEXT NOT NULL CHECK (row_type IN ('customer', 'measurement', 'employee', 'piece_rate', 'unknown')),
  status            TEXT NOT NULL CHECK (status IN ('valid', 'needs_review', 'accepted', 'excluded')),
  issues_json       TEXT NOT NULL, -- JSON array of issue strings
  manual_data_json  TEXT,          -- User-provided overrides
  legacy_id         TEXT,          -- Extracted legacy ID for mapping
  legacy_type       TEXT,          -- Corresponds to row_type when legacy_id is present
  created_at        TEXT NOT NULL,
  resolved_by       TEXT,
  resolved_at       TEXT
) STRICT;

CREATE INDEX idx_mig_rows_legacy ON mig_rows(upload_id, legacy_type, legacy_id);
