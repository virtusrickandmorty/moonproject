-- migrate: rebuild-with-foreign-keys-off
-- Sizer sets in Import old data (the owner's request, Oct 2026): a fifth kind of row, and of legacy mapping. The two
-- CHECKs are widened by copying the tables (same rows, same columns); the runner checks every link before keeping it.
CREATE TABLE mig_rows_next (
  id                TEXT PRIMARY KEY,
  upload_id         TEXT NOT NULL REFERENCES mig_uploads(id),
  row_number        INTEGER NOT NULL,
  raw_json          TEXT NOT NULL, -- The original CSV row parsed as JSON
  row_type          TEXT NOT NULL CHECK (row_type IN ('customer', 'measurement', 'employee', 'piece_rate', 'sizer_set', 'unknown')),
  status            TEXT NOT NULL CHECK (status IN ('valid', 'needs_review', 'accepted', 'merged', 'excluded')),
  issues_json       TEXT NOT NULL, -- JSON array of issue strings
  manual_data_json  TEXT,          -- User-provided overrides
  legacy_id         TEXT,          -- Extracted legacy ID for mapping
  legacy_type       TEXT,          -- Corresponds to row_type when legacy_id is present
  rate_cents        INTEGER CHECK (rate_cents IS NULL OR rate_cents >= 0),
  merge_into_row_id TEXT REFERENCES mig_rows(id), -- Retains this row's legacy ID for the future map
  created_at        TEXT NOT NULL,
  resolved_by       TEXT,
  resolved_at       TEXT
) STRICT;
INSERT INTO mig_rows_next SELECT id, upload_id, row_number, raw_json, row_type, status, issues_json, manual_data_json, legacy_id,
  legacy_type, rate_cents, merge_into_row_id, created_at, resolved_by, resolved_at FROM mig_rows;
DROP TABLE mig_rows;
ALTER TABLE mig_rows_next RENAME TO mig_rows;
CREATE INDEX idx_mig_rows_legacy ON mig_rows(upload_id, legacy_type, legacy_id);

CREATE TABLE mig_legacy_map_next (
  legacy_kind TEXT NOT NULL CHECK (legacy_kind IN ('customer','group','wearer','measurement','employee','piece_rate','sizer_set')),
  legacy_id TEXT NOT NULL,
  new_id TEXT NOT NULL,
  upload_id TEXT NOT NULL REFERENCES mig_uploads(id),
  PRIMARY KEY (legacy_kind, legacy_id)
) STRICT;
INSERT INTO mig_legacy_map_next SELECT legacy_kind, legacy_id, new_id, upload_id FROM mig_legacy_map;
DROP TABLE mig_legacy_map;
ALTER TABLE mig_legacy_map_next RENAME TO mig_legacy_map;
CREATE INDEX mig_legacy_map_upload ON mig_legacy_map(upload_id);
CREATE TRIGGER mig_legacy_map_no_update BEFORE UPDATE ON mig_legacy_map
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: legacy mappings cannot change'); END;
