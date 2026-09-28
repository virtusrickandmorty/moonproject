-- A loan that financed a fixed asset (PLAN D5 FA-BUY "financed" and LOAN-IN, E10). The FA- purchase already credited
-- 2602 with the financed part, with the FA- document as party, because the lender paid the supplier directly. So no
-- cash arrives: the loan's proceeds clear that credit, and the loan (this LOAN- document) becomes the party owed.
--   Dr 2602 (party = the FA- purchase) principal − fees ; Dr 7201 fees / Cr 2602 (party = this loan) principal
-- For such a loan cash_account_id holds 2602 itself, since no cash place received anything.
ALTER TABLE loan_loans ADD COLUMN asset_purchase_id TEXT REFERENCES documents(id);
CREATE INDEX loan_loans_asset ON loan_loans(asset_purchase_id) WHERE asset_purchase_id IS NOT NULL;
