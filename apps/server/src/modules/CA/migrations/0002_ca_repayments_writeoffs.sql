-- Cash advance repayments (CAR-, PLAN D5 CA-REPAY) and write-offs (CAW-, CA-WO). Like ca_advances, these rows only
-- keep what was recorded; what an employee owes is GL 1210 (party employee), read from journals (D9 L10).
CREATE TABLE ca_repayments (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  employee_id     TEXT NOT NULL,
  employee_name   TEXT NOT NULL, -- as it read when recorded
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  reference       TEXT,
  note            TEXT
) STRICT;
CREATE INDEX ca_repayments_employee ON ca_repayments(employee_id);
CREATE TRIGGER ca_repayments_no_update BEFORE UPDATE ON ca_repayments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded repayments are cancelled, never edited'); END;

CREATE TABLE ca_writeoffs (
  document_id        TEXT PRIMARY KEY REFERENCES documents(id),
  employee_id        TEXT NOT NULL,
  employee_name      TEXT NOT NULL,
  expense_account_id INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  reason             TEXT NOT NULL
) STRICT;
CREATE INDEX ca_writeoffs_employee ON ca_writeoffs(employee_id);
CREATE TRIGGER ca_writeoffs_no_update BEFORE UPDATE ON ca_writeoffs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded write-offs are cancelled, never edited'); END;
