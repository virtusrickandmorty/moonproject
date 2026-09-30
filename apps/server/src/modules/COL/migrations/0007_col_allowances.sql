-- Allowance for credit losses (BAD-ALLOW, ACC-26): the allowance needed on a date, per customer or in total, suggested
-- from the AR aging with a rate per age bucket the accountant types. It posts the change from each customer's 1209
-- balance: Dr 6270 / Cr 1209 when it goes up, Dr 1209 / Cr 6270 when it goes down. documents.total_cents = the
-- allowance needed (allowance_cents). Insert-only: a mistake is cancelled (mirror on its own date) and reissued.
CREATE TABLE col_allowances (
  document_id      TEXT PRIMARY KEY REFERENCES documents(id),
  basis            TEXT NOT NULL CHECK (basis IN ('customer','total')),
  as_of            TEXT NOT NULL,
  current_bp       INTEGER NOT NULL CHECK (current_bp BETWEEN 0 AND 10000),
  days1to30_bp     INTEGER NOT NULL CHECK (days1to30_bp BETWEEN 0 AND 10000),
  days31to60_bp    INTEGER NOT NULL CHECK (days31to60_bp BETWEEN 0 AND 10000),
  days61to90_bp    INTEGER NOT NULL CHECK (days61to90_bp BETWEEN 0 AND 10000),
  over90_bp        INTEGER NOT NULL CHECK (over90_bp BETWEEN 0 AND 10000),
  typed_total_cents INTEGER CHECK (typed_total_cents >= 0), -- in total: the amount the accountant typed instead of the suggestion
  suggested_cents  INTEGER NOT NULL CHECK (suggested_cents >= 0),
  allowance_cents  INTEGER NOT NULL CHECK (allowance_cents >= 0),
  balance_cents    INTEGER NOT NULL, -- 1209 (credit-positive) on as_of before this document
  reason           TEXT NOT NULL,
  CHECK (basis = 'total' OR typed_total_cents IS NULL)
) STRICT;
CREATE INDEX col_allowances_date ON col_allowances(as_of);

-- One row per customer the allowance touches: its open receivable on the aging, the suggestion, what the accountant
-- typed instead (per customer only), the allowance needed, the 1209 balance before and the change posted.
CREATE TABLE col_allowance_lines (
  document_id     TEXT NOT NULL REFERENCES col_allowances(document_id),
  line_no         INTEGER NOT NULL,
  customer_id     TEXT NOT NULL,
  customer_name   TEXT NOT NULL, -- as it read when recorded
  aging_cents     INTEGER NOT NULL CHECK (aging_cents >= 0),
  suggested_cents INTEGER NOT NULL CHECK (suggested_cents >= 0),
  typed_cents     INTEGER CHECK (typed_cents >= 0),
  allowance_cents INTEGER NOT NULL CHECK (allowance_cents >= 0),
  balance_cents   INTEGER NOT NULL,
  change_cents    INTEGER NOT NULL CHECK (change_cents = allowance_cents - balance_cents),
  PRIMARY KEY (document_id, line_no)
) STRICT;

-- The bad-debt method a write-off used (the setting acc.bad_debt_method on its date). A write-off with no row here was
-- recorded before the allowance method was built, so it is direct.
CREATE TABLE col_write_off_methods (
  document_id TEXT PRIMARY KEY REFERENCES col_write_offs(document_id),
  method      TEXT NOT NULL CHECK (method IN ('direct','allowance'))
) STRICT;

CREATE TRIGGER col_allowances_no_update BEFORE UPDATE ON col_allowances
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded allowances are cancelled and reissued, never edited'); END;
CREATE TRIGGER col_allowance_lines_no_update BEFORE UPDATE ON col_allowance_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded allowances are cancelled and reissued, never edited'); END;
CREATE TRIGGER col_write_off_methods_no_update BEFORE UPDATE ON col_write_off_methods
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded write-offs are cancelled and reissued, never edited'); END;
