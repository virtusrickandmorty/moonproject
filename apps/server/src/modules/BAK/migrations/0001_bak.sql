-- BAK module tables (prefix bak_), PLAN C8, E13, NR-13: where backups go, the recovery keys that can open them, and a
-- log of every run.

-- One row. Backups are encrypted to the two recovery public keys (age "age1..." recipients); the matching secret keys
-- are printed and kept by the owners, never stored here. Changed by the owner with a fresh password, and audited.
CREATE TABLE bak_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  backup_dir  TEXT NOT NULL CHECK (length(trim(backup_dir)) > 0),
  offsite_dir TEXT,                                   -- the Google Drive for desktop folder, or NULL
  recipients  TEXT NOT NULL CHECK (json_valid(recipients) AND json_array_length(recipients) = 2),
  version     INTEGER NOT NULL CHECK (version >= 1),
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL
) STRICT;

-- Every backup attempt, ok or not (the status page and the "backup stale" notice read it).
CREATE TABLE bak_runs (
  id          TEXT PRIMARY KEY,
  started_at  TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('schedule', 'manual', 'pre_update')),
  tier        TEXT NOT NULL CHECK (tier IN ('snapshot', 'daily', 'monthly', 'yearly')),
  status      TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  file        TEXT,                                   -- the encrypted file's name in the backup folder
  bytes       INTEGER,                                -- its size
  sha256      TEXT,                                   -- of the plain database copy, as in the sidecar
  offsite     INTEGER NOT NULL CHECK (offsite IN (0, 1)),
  error       TEXT,
  user_id     TEXT,                                   -- NULL for the scheduler
  CHECK (status = 'failed' OR (file IS NOT NULL AND bytes > 0 AND length(sha256) = 64)),
  CHECK (status = 'ok' OR error IS NOT NULL)
) STRICT;
CREATE INDEX bak_runs_at ON bak_runs(finished_at);
CREATE TRIGGER bak_runs_no_update BEFORE UPDATE ON bak_runs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: the backup log is never edited'); END;
