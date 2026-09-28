CREATE TABLE mig_legacy_map (
  legacy_kind TEXT NOT NULL CHECK (legacy_kind IN ('customer','group','wearer','measurement','employee','piece_rate')),
  legacy_id TEXT NOT NULL,
  new_id TEXT NOT NULL,
  upload_id TEXT NOT NULL REFERENCES mig_uploads(id),
  PRIMARY KEY (legacy_kind, legacy_id)
) STRICT;
CREATE INDEX mig_legacy_map_upload ON mig_legacy_map(upload_id);
CREATE TRIGGER mig_legacy_map_no_update BEFORE UPDATE ON mig_legacy_map
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: legacy mappings cannot change'); END;

ALTER TABLE mig_uploads ADD COLUMN committed_at TEXT;
ALTER TABLE mig_uploads ADD COLUMN committed_by TEXT;
ALTER TABLE mig_uploads ADD COLUMN counts_json TEXT;
ALTER TABLE mig_uploads ADD COLUMN checksums_json TEXT;
ALTER TABLE mig_uploads ADD COLUMN cleared_at TEXT;
ALTER TABLE mig_uploads ADD COLUMN cleared_by TEXT;
