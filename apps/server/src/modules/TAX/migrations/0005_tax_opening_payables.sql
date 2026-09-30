-- Opening tax payable (OBTP-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): the BIR returns of periods before the cut-over
-- date that were prepared from the old books and not yet paid. One row per return (form and period); a 0619-E or
-- 1601-EQ row has one line per supplier and ATC, the others one line. Cr 2302 VAT payable (2550Q), 2311 EWT payable per
-- supplier (0619-E, 1601-EQ) or 2320 income tax payable (1702Q, 1702) / Dr 3900. documents.total_cents = Σ amount_cents.
CREATE TABLE tax_opening_payables (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  note        TEXT
) STRICT;

CREATE TABLE tax_opening_payable_lines (
  document_id   TEXT NOT NULL REFERENCES tax_opening_payables(document_id),
  line_no       INTEGER NOT NULL CHECK (line_no >= 1),
  row_no        INTEGER NOT NULL CHECK (row_no >= 1), -- the return (form and period) the line belongs to
  form          TEXT NOT NULL CHECK (form IN ('2550Q', '0619-E', '1601-EQ', '1702Q', '1702')),
  period        TEXT NOT NULL, -- 2026-07 for 0619-E, 2025 for 1702, else 2026-Q2
  supplier_id   TEXT,          -- 0619-E and 1601-EQ: the PUR supplier the EWT was withheld from (the party on 2311)
  supplier_name TEXT,          -- as registered when recorded
  atc           TEXT,          -- 0619-E and 1601-EQ
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0), -- still to pay with the return
  PRIMARY KEY (document_id, line_no),
  CHECK ((form = '0619-E' AND period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]')
      OR (form = '1702' AND period GLOB '[0-9][0-9][0-9][0-9]')
      OR (form IN ('2550Q', '1601-EQ', '1702Q') AND period GLOB '[0-9][0-9][0-9][0-9]-Q[1-4]')),
  CHECK ((form IN ('0619-E', '1601-EQ')) = (supplier_id IS NOT NULL AND supplier_name IS NOT NULL AND atc IS NOT NULL)),
  CHECK (form IN ('0619-E', '1601-EQ') OR (supplier_id IS NULL AND supplier_name IS NULL AND atc IS NULL))
) STRICT;
CREATE INDEX tax_opening_payable_lines_period ON tax_opening_payable_lines(form, period);

CREATE TRIGGER tax_opening_payables_no_update BEFORE UPDATE ON tax_opening_payables
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an opening tax payable is cancelled and reissued, never edited'); END;
CREATE TRIGGER tax_opening_payable_lines_no_update BEFORE UPDATE ON tax_opening_payable_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an opening tax payable is cancelled and reissued, never edited'); END;
