-- Opening loans (OBLN-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): a loan or equipment financing received before the
-- cut-over date and not yet paid off. Its OBLN- document is the loan, in loan_loans and loan_schedule like a LOAN-, so
-- the register, the schedule and loan payments (LPAY-) treat both alike. For an opening loan:
--   principal_cents = the principal still owed on the cut-over date (what 2601/2602 is credited with and what the
--                     remaining schedule repays); fee_cents = 0; term_months = the months left;
--   cash_account_id = 3900 opening balance equity, since no cash arrives (Dr 3900 / Cr 2601 or 2602).
-- This table keeps what the register shows of the loan before the cut-over: its original principal and date received.
CREATE TABLE loan_openings (
  document_id              TEXT PRIMARY KEY REFERENCES loan_loans(document_id),
  original_principal_cents INTEGER NOT NULL CHECK (original_principal_cents > 0),
  date_received            TEXT NOT NULL
) STRICT;
CREATE TRIGGER loan_openings_no_update BEFORE UPDATE ON loan_openings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: opening loans are cancelled, never edited'); END;
