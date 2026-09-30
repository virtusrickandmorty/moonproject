-- Dividends (PLAN D5 DIV, E10). The register gets each stockholder's TIN and whether they are an individual (a resident
-- citizen: 10% final tax on cash dividends) or a domestic corporation (none). Both are master data like the rest of the
-- register; a declaration copies them onto its lines, so a later edit never changes a posted declaration.
ALTER TABLE eq_people ADD COLUMN tin TEXT CHECK (tin IS NULL OR tin GLOB '[0-9][0-9][0-9]-[0-9][0-9][0-9]-[0-9][0-9][0-9]-[0-9][0-9][0-9]*');
ALTER TABLE eq_people ADD COLUMN holder_kind TEXT NOT NULL DEFAULT 'individual' CHECK (holder_kind IN ('individual', 'corporation'));

-- Dividend declaration (DIV-): Dr 3210 dividends declared (the total) / Cr 2503 dividends payable per stockholder (net)
-- / Cr 2312 final withholding tax payable (the tax). documents.total_cents = total_cents; the date is the declaration's.
CREATE TABLE eq_dividend_declarations (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  resolution_number TEXT NOT NULL CHECK (length(trim(resolution_number)) >= 1),
  resolution_date   TEXT NOT NULL CHECK (resolution_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  record_date       TEXT NOT NULL CHECK (record_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  basis             TEXT NOT NULL CHECK (basis IN ('per_share', 'total')),
  per_share_cents   INTEGER CHECK (per_share_cents IS NULL OR per_share_cents > 0),
  total_cents       INTEGER NOT NULL CHECK (total_cents > 0),
  shares            INTEGER NOT NULL CHECK (shares > 0), -- held by the stockholders on the record date
  tax_rate_bp       INTEGER NOT NULL CHECK (tax_rate_bp >= 0), -- tax.dividend_final_tax_bp on the declaration date
  tax_cents         INTEGER NOT NULL CHECK (tax_cents >= 0),
  -- The retained earnings on the declaration date before this declaration (EQ dividends.ts), as the check read them.
  retained_cents       INTEGER NOT NULL, -- 3201
  current_year_cents   INTEGER NOT NULL, -- income less expenses of the year to the declaration date
  earlier_years_cents  INTEGER NOT NULL, -- earlier years' income less expenses not yet closed to 3201
  declared_cents       INTEGER NOT NULL, -- 3210 dividends declared before this one
  note              TEXT,
  CHECK ((basis = 'per_share') = (per_share_cents IS NOT NULL))
) STRICT;

-- One line per stockholder holding shares on the record date: gross = tax + net; net is credited to 2503.
CREATE TABLE eq_dividend_lines (
  document_id TEXT NOT NULL REFERENCES eq_dividend_declarations(document_id),
  person_id   TEXT NOT NULL REFERENCES eq_people(id),
  name        TEXT NOT NULL,
  tin         TEXT,
  holder_kind TEXT NOT NULL CHECK (holder_kind IN ('individual', 'corporation')),
  shares      INTEGER NOT NULL CHECK (shares > 0),
  gross_cents INTEGER NOT NULL CHECK (gross_cents > 0),
  tax_cents   INTEGER NOT NULL CHECK (tax_cents >= 0 AND tax_cents <= gross_cents),
  net_cents   INTEGER NOT NULL CHECK (net_cents = gross_cents - tax_cents),
  PRIMARY KEY (document_id, person_id)
) STRICT;
CREATE INDEX eq_dividend_lines_person ON eq_dividend_lines(person_id);

-- Dividend payment (DIVP-): Dr 2503 dividends payable (the stockholder) / Cr cash place.
CREATE TABLE eq_dividend_payments (
  document_id  TEXT PRIMARY KEY REFERENCES documents(id),
  person_id    TEXT NOT NULL REFERENCES eq_people(id),
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  payable_cents INTEGER NOT NULL CHECK (payable_cents > 0), -- what the stockholder was owed on 2503 when recorded
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= payable_cents),
  note          TEXT
) STRICT;
CREATE INDEX eq_dividend_payments_person ON eq_dividend_payments(person_id);

CREATE TRIGGER eq_dividend_declarations_no_update BEFORE UPDATE ON eq_dividend_declarations
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a posted dividend declaration is cancelled, never edited'); END;
CREATE TRIGGER eq_dividend_lines_no_update BEFORE UPDATE ON eq_dividend_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a posted dividend declaration is cancelled, never edited'); END;
CREATE TRIGGER eq_dividend_payments_no_update BEFORE UPDATE ON eq_dividend_payments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a posted dividend payment is cancelled, never edited'); END;
