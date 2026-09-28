-- BIR payment (BIRP-, PLAN D5 VAT-PAY and EWT-REM): the tax paid with one BIR return. A 2550Q pays what a quarter's VAT
-- close made payable (Dr 2302); a 0619-E (month 1 or 2 of a quarter) or 1601-EQ (the quarter, less its 0619-E payments)
-- pays the EWT withheld in its period, per payee (Dr 2311). A penalty (surcharge, interest, compromise) goes to 6290 in
-- the same journal, and the cash credit covers both. documents.total_cents = amount_cents + penalty_cents.
CREATE TABLE tax_bir_payments (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  form            TEXT NOT NULL CHECK (form IN ('2550Q', '0619-E', '1601-EQ')),
  period          TEXT NOT NULL, -- 2026-Q3 for 2550Q and 1601-EQ, 2026-07 for 0619-E
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  reference       TEXT NOT NULL, -- eFPS, eBIRForms or bank reference
  vat_close_id    TEXT REFERENCES documents(id), -- 2550Q: the VAT close whose payable it pays
  payable_cents   INTEGER NOT NULL CHECK (payable_cents > 0), -- what the period left payable when recorded
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= payable_cents),
  penalty_cents   INTEGER NOT NULL DEFAULT 0 CHECK (penalty_cents >= 0),
  note            TEXT,
  CHECK ((form = '0619-E' AND period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]') OR (form <> '0619-E' AND period GLOB '[0-9][0-9][0-9][0-9]-Q[1-4]')),
  CHECK ((form = '2550Q') = (vat_close_id IS NOT NULL))
) STRICT;
CREATE INDEX tax_bir_payments_period ON tax_bir_payments(form, period);

-- What an EWT payment cleared per payee (the party on 2311: a supplier id, or tin:... for a one-off payee).
CREATE TABLE tax_bir_payment_lines (
  document_id   TEXT NOT NULL REFERENCES tax_bir_payments(document_id),
  party_id      TEXT NOT NULL,
  payee_name    TEXT NOT NULL, -- as registered when recorded
  payable_cents INTEGER NOT NULL CHECK (payable_cents > 0),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= payable_cents),
  PRIMARY KEY (document_id, party_id)
) STRICT;

CREATE TRIGGER tax_bir_payments_no_update BEFORE UPDATE ON tax_bir_payments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a BIR payment is cancelled, never edited'); END;
CREATE TRIGGER tax_bir_payment_lines_no_update BEFORE UPDATE ON tax_bir_payment_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a BIR payment is cancelled, never edited'); END;
