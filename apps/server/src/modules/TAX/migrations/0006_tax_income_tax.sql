-- Quarterly income tax (1702Q, PLAN D5 IT-QPAY, D8 "Quarterly", E12).
-- The income tax settings: dated like the engine's settings (a new version is a new row from today or later, never
-- edited), read on the last day of the quarter a 1702Q covers. The regular rate is 20% or 25% by the corporation's
-- size (CREATE); MCIT is a rate on gross income that applies from the 4th taxable year after the year operations
-- began. NULL operations_began_year: not confirmed yet, so the worksheet leaves MCIT out and says so.
CREATE TABLE tax_income_tax_settings (
  id                    INTEGER PRIMARY KEY,
  effective_from        TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  regular_rate_bp       INTEGER NOT NULL CHECK (regular_rate_bp BETWEEN 0 AND 5000),
  mcit_rate_bp          INTEGER NOT NULL CHECK (mcit_rate_bp BETWEEN 0 AND 1000),
  operations_began_year INTEGER CHECK (operations_began_year BETWEEN 1900 AND 2999),
  reason                TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  created_by            TEXT REFERENCES users(id) -- NULL: the default at install, not yet confirmed by the accountant
) STRICT;
CREATE INDEX tax_income_tax_settings_from ON tax_income_tax_settings(effective_from);
CREATE TRIGGER tax_income_tax_settings_no_update BEFORE UPDATE ON tax_income_tax_settings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a setting gets a new version, never an edit'); END;

INSERT INTO tax_income_tax_settings (effective_from, regular_rate_bp, mcit_rate_bp, operations_began_year, reason, created_at) VALUES
('2000-01-01', 2000, 200, NULL, 'Default at install: regular rate 20% (small corporation, CREATE), MCIT 2% of gross income; the year operations began to confirm', '2026-09-28T00:00:00.000+08:00');

-- The BIR payment (BIRP-, tax.bir_payment) of a 1702Q: the income tax paid with the quarterly return of Q1 to Q3.
-- Dr 1411 prepaid income tax (IT-QPAY), or Dr 2320 income tax payable when an opening tax payable (OBTP-) brought in
-- that quarter's 1702Q from the old books (opening_id); Dr 6290 penalty / Cr cash place. Kept apart from
-- tax_bir_payments, whose form list (0003) is 2550Q, 0619-E and 1601-EQ. documents.total_cents = amount + penalty.
-- More than the worksheet leaves to pay needs a note (the return says more than the books); never over an opening.
CREATE TABLE tax_income_tax_payments (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  period          TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-Q[1-3]'),
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  reference       TEXT NOT NULL, -- eFPS, eBIRForms or bank reference
  opening_id      TEXT REFERENCES documents(id), -- the opening tax payable whose 1702Q (on 2320) it pays
  payable_cents   INTEGER NOT NULL CHECK (payable_cents >= 0), -- what the quarter left to pay when recorded
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  penalty_cents   INTEGER NOT NULL DEFAULT 0 CHECK (penalty_cents >= 0),
  note            TEXT,
  CHECK (amount_cents <= payable_cents OR (note IS NOT NULL AND opening_id IS NULL))
) STRICT;
CREATE INDEX tax_income_tax_payments_period ON tax_income_tax_payments(period);
CREATE TRIGGER tax_income_tax_payments_no_update BEFORE UPDATE ON tax_income_tax_payments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a BIR payment is cancelled, never edited'); END;
