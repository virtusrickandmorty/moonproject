-- Loan forgiveness (LFGV-, the owner's decision of 6 Oct 2026): the lender forgives what is still due on one instalment
-- (the rest of a short payment, or all of it). It closes the instalment like a payment does. Only the forgiven principal
-- posts: Dr 2601/2602 (party = the loan) / Cr gain on debt forgiveness. The forgiven interest posts nothing (interest is
-- expensed only when paid, so it was never booked); it is kept here so the instalment reads as settled.
CREATE TABLE loan_forgivenesses (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  loan_id         TEXT NOT NULL,
  instalment_no   INTEGER NOT NULL,
  principal_cents INTEGER NOT NULL CHECK (principal_cents >= 0),
  interest_cents  INTEGER NOT NULL CHECK (interest_cents >= 0),
  reason          TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 200),
  note            TEXT,
  CHECK (principal_cents + interest_cents > 0),
  FOREIGN KEY (loan_id, instalment_no) REFERENCES loan_schedule(loan_id, instalment_no)
) STRICT;
CREATE INDEX loan_forgivenesses_loan ON loan_forgivenesses(loan_id, instalment_no);
CREATE TRIGGER loan_forgivenesses_no_update BEFORE UPDATE ON loan_forgivenesses
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded forgivenesses are cancelled, never edited'); END;

-- Gain on debt forgiveness, under 7100 Other income (credit-normal revenue like 7101-7103), between 7103 other income
-- (1350) and the 7200 header (1360). Role key GAIN_ON_DEBT_FORGIVENESS so the posting rule names it; postable, not
-- reserved, no party. The chart had no such account. The accountant may have added accounts of their own, so it takes
-- the first free code from 7104.
INSERT INTO accounts (code, name, type, normal_side, role_key, party_type, is_header, is_postable, is_cash_place, is_reserved, sort_order)
SELECT c.column1, 'Gain on debt forgiveness', 'revenue', 'credit', 'GAIN_ON_DEBT_FORGIVENESS', NULL, 0, 1, 0, 0, 1355
  FROM (VALUES ('7104'), ('7105'), ('7106'), ('7107'), ('7108'), ('7109')) c
 WHERE c.column1 NOT IN (SELECT code FROM accounts)
 ORDER BY c.column1 LIMIT 1;
