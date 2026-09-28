-- LOAN module tables (prefix loan_). A loan is its LOAN- document; loans, schedules and payments are insert-only.

-- The loan register (PLAN E10). The document id is the loan's id and the party id on 2601/2602 (party type loan).
-- The date received is the document's date.
CREATE TABLE loan_loans (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  lender          TEXT NOT NULL CHECK (length(trim(lender)) >= 2),
  kind            TEXT NOT NULL CHECK (kind IN ('loan', 'equipment')), -- 2601 loans payable, 2602 equipment financing
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  principal_cents INTEGER NOT NULL CHECK (principal_cents > 0),
  fee_cents       INTEGER NOT NULL CHECK (fee_cents >= 0 AND fee_cents < principal_cents), -- deducted from the proceeds
  fee_account_id  INTEGER REFERENCES accounts(id), -- NULL: 7201 interest and financing charges (D5)
  rate_bp         INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000), -- yearly, in basis points
  term_months     INTEGER NOT NULL CHECK (term_months BETWEEN 1 AND 360),
  schedule        TEXT NOT NULL CHECK (schedule IN ('declining', 'flat', 'typed')),
  reference       TEXT, -- the lender's loan or promissory note number
  note            TEXT
) STRICT;
CREATE TRIGGER loan_loans_no_update BEFORE UPDATE ON loan_loans
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded loans are cancelled, never edited'); END;

-- The repayment schedule, generated or typed, written once with the loan.
CREATE TABLE loan_schedule (
  loan_id         TEXT NOT NULL REFERENCES loan_loans(document_id),
  instalment_no   INTEGER NOT NULL CHECK (instalment_no > 0),
  due_date        TEXT NOT NULL,
  principal_cents INTEGER NOT NULL CHECK (principal_cents >= 0),
  interest_cents  INTEGER NOT NULL CHECK (interest_cents >= 0),
  PRIMARY KEY (loan_id, instalment_no)
) STRICT;
CREATE TRIGGER loan_schedule_no_update BEFORE UPDATE ON loan_schedule
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: schedule rows are insert-only'); END;

-- Loan payments (LPAY-): one instalment each, split into principal and interest.
CREATE TABLE loan_payments (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  loan_id         TEXT NOT NULL,
  instalment_no   INTEGER NOT NULL,
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  principal_cents INTEGER NOT NULL CHECK (principal_cents >= 0),
  interest_cents  INTEGER NOT NULL CHECK (interest_cents >= 0),
  note            TEXT, -- required when the split differs from the schedule
  CHECK (principal_cents + interest_cents > 0),
  FOREIGN KEY (loan_id, instalment_no) REFERENCES loan_schedule(loan_id, instalment_no)
) STRICT;
CREATE INDEX loan_payments_loan ON loan_payments(loan_id, instalment_no);
CREATE TRIGGER loan_payments_no_update BEFORE UPDATE ON loan_payments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded payments are cancelled, never edited'); END;
