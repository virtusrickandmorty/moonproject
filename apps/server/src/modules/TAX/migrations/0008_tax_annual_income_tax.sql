-- Annual income tax (1702-RT, PLAN D5 IT-PROV and IT-SETTLE, D8 "Yearly", E12).
-- The deductions a year's return takes: itemized (the default at install, not confirmed) or the 40% optional standard
-- deduction on gross income. Dated like the other settings: a new version is a new row from today or later, never
-- edited; the version of a year in force on a date is the newest one for that year dated on or before it.
CREATE TABLE tax_income_tax_deductions (
  id             INTEGER PRIMARY KEY,
  year           INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  method         TEXT NOT NULL CHECK (method IN ('itemized', 'osd')),
  effective_from TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  reason         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX tax_income_tax_deductions_year ON tax_income_tax_deductions(year, effective_from);
CREATE TRIGGER tax_income_tax_deductions_no_update BEFORE UPDATE ON tax_income_tax_deductions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a setting gets a new version, never an edit'); END;

-- Income tax provision (ITP-, IT-PROV): the year's income tax from the 1702-RT worksheet, dated 31 December.
-- Dr 8101 income tax – current / Cr 2320 income tax payable, amount_cents = tax_due_cents less what the old books'
-- 1702Qs of the year (opening tax payables) already put on 2320. One posted per year. documents.total_cents = amount.
CREATE TABLE tax_income_tax_provisions (
  document_id          TEXT PRIMARY KEY REFERENCES documents(id),
  year                 INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  deduction_method     TEXT NOT NULL CHECK (deduction_method IN ('itemized', 'osd')),
  taxable_income_cents INTEGER NOT NULL,
  basis                TEXT NOT NULL CHECK (basis IN ('regular', 'mcit')),
  tax_due_cents        INTEGER NOT NULL CHECK (tax_due_cents >= 0),
  opened_cents         INTEGER NOT NULL CHECK (opened_cents >= 0),
  amount_cents         INTEGER NOT NULL CHECK (amount_cents > 0),
  note                 TEXT,
  CHECK (amount_cents = tax_due_cents - opened_cents)
) STRICT;
CREATE INDEX tax_income_tax_provisions_year ON tax_income_tax_provisions(year);
CREATE TRIGGER tax_income_tax_provisions_no_update BEFORE UPDATE ON tax_income_tax_provisions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an income tax provision is cancelled, never edited'); END;

-- Income tax settlement (ITS-, IT-SETTLE): the year's credits applied against its income tax.
--   Dr 2320 liability_cents (what the year left on 2320 less what the return still leaves to pay)
--   Dr 1411 carry_over_cents (an overpayment, carried over to the next year)
--   Cr 1411 prepaid_cents (the year's 1702Q payments on 1411, other prepaid dated in the year, last year's carry-over)
--   Cr 1410 per customer (CWT of the year with the 2307 in hand; tax_income_tax_settlement_lines)
--   8101 rounding_cents (Cr when positive, Dr when negative): the return is in whole pesos, the books in centavos.
-- payable_cents is what the return leaves to pay (below zero: the overpayment carried over).
CREATE TABLE tax_income_tax_settlements (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  year              INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  provision_id      TEXT REFERENCES documents(id), -- NULL when the year had nothing to provide
  tax_due_cents     INTEGER NOT NULL CHECK (tax_due_cents >= 0),
  payable_cents     INTEGER NOT NULL,
  liability_cents   INTEGER NOT NULL CHECK (liability_cents >= 0),
  carry_over_cents  INTEGER NOT NULL CHECK (carry_over_cents >= 0),
  prepaid_cents     INTEGER NOT NULL CHECK (prepaid_cents >= 0),
  cwt_cents         INTEGER NOT NULL,
  cwt_pending_cents INTEGER NOT NULL CHECK (cwt_pending_cents >= 0),
  rounding_cents    INTEGER NOT NULL,
  note              TEXT,
  CHECK (carry_over_cents = CASE WHEN payable_cents < 0 THEN -payable_cents ELSE 0 END),
  CHECK (liability_cents + carry_over_cents = prepaid_cents + cwt_cents + rounding_cents)
) STRICT;
CREATE INDEX tax_income_tax_settlements_year ON tax_income_tax_settlements(year);
CREATE TRIGGER tax_income_tax_settlements_no_update BEFORE UPDATE ON tax_income_tax_settlements
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an income tax settlement is cancelled, never edited'); END;

CREATE TABLE tax_income_tax_settlement_lines (
  document_id  TEXT NOT NULL REFERENCES tax_income_tax_settlements(document_id),
  customer_id  TEXT NOT NULL, -- the party on 1410
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0), -- CWT claimed (Cr 1410); below zero a Dr
  PRIMARY KEY (document_id, customer_id)
) STRICT;
CREATE TRIGGER tax_income_tax_settlement_lines_no_update BEFORE UPDATE ON tax_income_tax_settlement_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an income tax settlement is cancelled, never edited'); END;

-- The BIR payment (BIRP-, tax.bir_payment) of a 1702 (the annual return, period = the year): Dr 2320 income tax
-- payable, what the year's settlement left to pay (settlement_id), or what an opening tax payable (OBTP-) brought in
-- from the old books for a year before the cut-over date (opening_id); Dr 6290 penalty / Cr cash place.
CREATE TABLE tax_income_tax_annual_payments (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  period          TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]'),
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  reference       TEXT NOT NULL,
  settlement_id   TEXT REFERENCES documents(id),
  opening_id      TEXT REFERENCES documents(id),
  payable_cents   INTEGER NOT NULL CHECK (payable_cents > 0),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= payable_cents),
  penalty_cents   INTEGER NOT NULL DEFAULT 0 CHECK (penalty_cents >= 0),
  note            TEXT,
  CHECK ((settlement_id IS NULL) <> (opening_id IS NULL))
) STRICT;
CREATE INDEX tax_income_tax_annual_payments_period ON tax_income_tax_annual_payments(period);
CREATE TRIGGER tax_income_tax_annual_payments_no_update BEFORE UPDATE ON tax_income_tax_annual_payments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a BIR payment is cancelled, never edited'); END;
