-- Restore checks and drills, and USB copies (PLAN C8 "Restore", E "Backup/Restore screens").

-- Every time a backup was opened with a recovery key and checked: a quarterly drill, or the first step of a restore.
CREATE TABLE bak_restore_checks (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     TEXT,                                   -- NULL from the command-line restore
  purpose     TEXT NOT NULL CHECK (purpose IN ('drill', 'restore')),
  file        TEXT NOT NULL,                          -- the encrypted backup's file name
  result      TEXT NOT NULL CHECK (result IN ('ok', 'failed')),
  error       TEXT,
  facts       TEXT,                                   -- JSON: what the check found (dates, trial balance, audit head)
  CHECK (result = 'ok' OR error IS NOT NULL)
) STRICT;
CREATE INDEX bak_restore_checks_at ON bak_restore_checks(at);
CREATE TRIGGER bak_restore_checks_no_update BEFORE UPDATE ON bak_restore_checks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: the restore log is never edited'); END;

-- Backups copied to one of the two USB drives, rotated weekly.
CREATE TABLE bak_usb_copies (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  drive       TEXT NOT NULL CHECK (drive IN ('A', 'B')),
  dir         TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  copied      INTEGER NOT NULL CHECK (copied >= 0),   -- backups copied this time (the rest were there already)
  error       TEXT,
  CHECK (status = 'ok' OR error IS NOT NULL)
) STRICT;
CREATE INDEX bak_usb_copies_at ON bak_usb_copies(at);
CREATE TRIGGER bak_usb_copies_no_update BEFORE UPDATE ON bak_usb_copies
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: the USB copy log is never edited'); END;
