-- Journal voucher (PLAN D5 "JV", E12): the one place the accountant picks accounts freely. Insert-only: a mistake
-- is cancelled (mirror journal) and reissued.
CREATE TABLE acc_journal_vouchers (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  memo        TEXT NOT NULL,
  is_late     INTEGER NOT NULL CHECK (is_late IN (0,1)), -- dated before the day it was recorded
  late_reason TEXT,
  CHECK (is_late = 0 OR late_reason IS NOT NULL)
) STRICT;

CREATE TABLE acc_jv_lines (
  document_id  TEXT NOT NULL REFERENCES acc_journal_vouchers(document_id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  party_type   TEXT,
  party_id     TEXT,
  debit_cents  INTEGER NOT NULL CHECK (debit_cents >= 0),
  credit_cents INTEGER NOT NULL CHECK (credit_cents >= 0),
  memo         TEXT,
  PRIMARY KEY (document_id, line_no),
  CHECK ((debit_cents > 0) <> (credit_cents > 0)),
  CHECK ((party_type IS NULL) = (party_id IS NULL))
) STRICT;

CREATE TRIGGER acc_journal_vouchers_no_update BEFORE UPDATE ON acc_journal_vouchers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded journal vouchers are cancelled and reissued, never edited'); END;
CREATE TRIGGER acc_jv_lines_no_update BEFORE UPDATE ON acc_jv_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded journal vouchers are cancelled and reissued, never edited'); END;
