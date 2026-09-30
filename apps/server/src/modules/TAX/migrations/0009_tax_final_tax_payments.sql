-- BIR payment of a 1601-FQ (BIRP-, PLAN D5 DIV): the final tax withheld in a quarter (on dividends, EQ), paid with
-- the quarterly final withholding tax return. Dr 2312 final withholding tax payable (+ Dr 6290 penalty) / Cr cash place.
-- Its own table because tax_bir_payments (0003) takes only 2550Q, 0619-E and 1601-EQ. documents.total_cents =
-- amount_cents + penalty_cents.
CREATE TABLE tax_final_tax_payments (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  period          TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-Q[1-4]'),
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  reference       TEXT NOT NULL, -- eFPS, eBIRForms or bank reference
  payable_cents   INTEGER NOT NULL CHECK (payable_cents > 0), -- what the quarter left payable when recorded
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= payable_cents),
  penalty_cents   INTEGER NOT NULL DEFAULT 0 CHECK (penalty_cents >= 0),
  note            TEXT
) STRICT;
CREATE INDEX tax_final_tax_payments_period ON tax_final_tax_payments(period);
CREATE TRIGGER tax_final_tax_payments_no_update BEFORE UPDATE ON tax_final_tax_payments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a BIR payment is cancelled, never edited'); END;
