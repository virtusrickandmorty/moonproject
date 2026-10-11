-- The employee's bank or GCash QR code (the owner's request, Oct 2026): a picture of the QR the employee pays into, so
-- whoever releases payroll can scan it to send the pay. Kept in the database like the online shop's payment QR, so a
-- backup carries it. Each save is a new version (the latest one is shown); taking the picture off saves a version
-- without one. Personal: the audit log says that it changed, never what it shows (C6).
CREATE TABLE emp_payout_qr (
  employee_id TEXT NOT NULL REFERENCES emp_employees(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  content_type TEXT CHECK (content_type IS NULL OR content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data BLOB,
  saved_by TEXT NOT NULL REFERENCES users(id),
  saved_at TEXT NOT NULL,
  PRIMARY KEY (employee_id, version),
  CHECK ((content_type IS NULL) = (data IS NULL))
) STRICT;
CREATE TRIGGER emp_payout_qr_no_update BEFORE UPDATE ON emp_payout_qr BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: save a new version'); END;
CREATE TRIGGER emp_payout_qr_no_delete BEFORE DELETE ON emp_payout_qr BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: save a new version'); END;
