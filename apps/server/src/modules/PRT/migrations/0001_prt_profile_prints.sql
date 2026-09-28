CREATE TABLE prt_company_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  registered_name TEXT NOT NULL,
  trade_name TEXT NOT NULL,
  tin TEXT NOT NULL,
  registered_address TEXT NOT NULL,
  is_vat_registered INTEGER NOT NULL CHECK (is_vat_registered IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id)
) STRICT;

CREATE TABLE prt_company_profile_history (
  id INTEGER PRIMARY KEY,
  registered_name TEXT NOT NULL,
  trade_name TEXT NOT NULL,
  tin TEXT NOT NULL,
  registered_address TEXT NOT NULL,
  is_vat_registered INTEGER NOT NULL CHECK (is_vat_registered IN (0, 1)),
  version INTEGER NOT NULL,
  superseded_at TEXT NOT NULL,
  superseded_by TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE TRIGGER prt_company_profile_history_no_update BEFORE UPDATE ON prt_company_profile_history
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: company profile history is append-only'); END;

CREATE TABLE prt_print_log (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  printed_at TEXT NOT NULL,
  copy_number INTEGER NOT NULL CHECK (copy_number >= 1),
  print_kind TEXT NOT NULL CHECK (print_kind IN ('document', 'job_ticket')),
  UNIQUE (document_id, print_kind, copy_number)
) STRICT;
CREATE TRIGGER prt_print_log_no_update BEFORE UPDATE ON prt_print_log
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: print log is append-only'); END;
