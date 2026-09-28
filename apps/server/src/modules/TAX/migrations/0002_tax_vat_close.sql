-- Quarterly VAT close (VATC-, PLAN D7 VAT-CLOSE, research vat-cwt-ewt §3.8 R46): what the accountant closed for one
-- quarter, and the per-party amounts of its journal so the document reads back exactly as posted.
CREATE TABLE tax_vat_closes (
  document_id                TEXT PRIMARY KEY REFERENCES documents(id),
  year                       INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  quarter                    INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  output_vat_cents           INTEGER NOT NULL,                              -- 2301 closed (the quarter plus earlier items not yet closed)
  input_vat_cents            INTEGER NOT NULL,                              -- 1401 closed
  vat_withheld_cents         INTEGER NOT NULL CHECK (vat_withheld_cents >= 0), -- 1404 claimed (2307 in hand)
  vat_withheld_pending_cents INTEGER NOT NULL CHECK (vat_withheld_pending_cents >= 0), -- 1404 left for a later quarter
  carry_over_cents           INTEGER NOT NULL,                              -- 1402 brought forward and applied
  payable_cents              INTEGER NOT NULL CHECK (payable_cents >= 0),   -- Cr 2302
  carry_forward_cents        INTEGER NOT NULL CHECK (carry_forward_cents >= 0), -- Dr 1402
  note                       TEXT,
  CHECK (payable_cents = 0 OR carry_forward_cents = 0),
  CHECK (output_vat_cents - input_vat_cents - vat_withheld_cents - carry_over_cents = payable_cents - carry_forward_cents)
) STRICT;
CREATE INDEX tax_vat_closes_quarter ON tax_vat_closes(year, quarter);
CREATE TRIGGER tax_vat_closes_no_update BEFORE UPDATE ON tax_vat_closes
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a VAT close is cancelled, never edited'); END;

CREATE TABLE tax_vat_close_lines (
  document_id  TEXT NOT NULL REFERENCES tax_vat_closes(document_id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  role_key     TEXT NOT NULL CHECK (role_key IN ('OUTPUT_VAT', 'INPUT_VAT', 'VAT_WITHHELD')),
  party_type   TEXT NOT NULL CHECK (party_type IN ('customer', 'supplier')),
  party_id     TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0), -- the party's balance closed, on the account's normal side
  PRIMARY KEY (document_id, line_no)
) STRICT;
CREATE TRIGGER tax_vat_close_lines_no_update BEFORE UPDATE ON tax_vat_close_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a VAT close is cancelled, never edited'); END;
