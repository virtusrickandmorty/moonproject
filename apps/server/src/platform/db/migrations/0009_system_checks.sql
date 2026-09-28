-- System Health (PLAN C8): each full system check (the database, the D9 ledger checks, the audit chain), run nightly by
-- the server or with the "Run system check" button. The page shows the newest; the rows stay as a record.
CREATE TABLE sys_checks (
  id      INTEGER PRIMARY KEY,
  at      TEXT NOT NULL,
  reason  TEXT NOT NULL CHECK (reason IN ('schedule', 'button')),
  user_id TEXT REFERENCES users(id), -- NULL for the nightly check
  ok      INTEGER NOT NULL CHECK (ok IN (0, 1)),
  results TEXT NOT NULL              -- JSON: SystemCheck in platform/health/health.ts
) STRICT;
CREATE TRIGGER sys_checks_no_update BEFORE UPDATE ON sys_checks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a system check is a record'); END;
