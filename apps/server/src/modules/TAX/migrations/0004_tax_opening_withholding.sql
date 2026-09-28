-- Opening withholding (OBWT-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): the customers' 2307s for sales before the
-- cut-over date whose tax withheld was not yet used on a return. One row per 2307: the customer, the quarter it covers,
-- the ATC, the CWT (1410) and the VAT withheld (1404), and whether the certificate was in hand at the cut-over.
-- documents.total_cents = Σ CWT + Σ VAT withheld (the 3900 credit).
CREATE TABLE tax_openings (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  note        TEXT
) STRICT;

CREATE TABLE tax_opening_lines (
  document_id        TEXT NOT NULL REFERENCES tax_openings(document_id),
  line_no            INTEGER NOT NULL CHECK (line_no >= 1),
  customer_id        TEXT NOT NULL,  -- a CUS customer
  customer_name      TEXT NOT NULL,  -- as it read when recorded
  year               INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  quarter            INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4), -- the quarter the 2307 covers
  atc                TEXT NOT NULL CHECK (atc IN ('WC158', 'WC160', 'other')),
  cwt_cents          INTEGER NOT NULL CHECK (cwt_cents >= 0),
  vat_withheld_cents INTEGER NOT NULL CHECK (vat_withheld_cents >= 0),
  cert_2307          TEXT NOT NULL CHECK (cert_2307 IN ('pending', 'received')), -- as recorded; a later receipt is in tax_2307_receipts
  PRIMARY KEY (document_id, line_no),
  CHECK (cwt_cents + vat_withheld_cents > 0)
) STRICT;
CREATE INDEX tax_opening_lines_customer ON tax_opening_lines(customer_id, year, quarter);

-- The customers' 2307 register (PLAN E5, owned by TAX): a certificate recorded as pending, on a collection or an opening
-- row, that came later. One row per certificate, never two; the day it was marked received is the server's date.
-- line_no is the opening's row, 0 for a collection's one 2307.
CREATE TABLE tax_2307_receipts (
  document_id TEXT NOT NULL REFERENCES documents(id),
  line_no     INTEGER NOT NULL CHECK (line_no >= 0),
  received_on TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (document_id, line_no)
) STRICT;

CREATE TRIGGER tax_openings_no_update BEFORE UPDATE ON tax_openings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an opening withholding is cancelled and reissued, never edited'); END;
CREATE TRIGGER tax_opening_lines_no_update BEFORE UPDATE ON tax_opening_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an opening withholding is cancelled and reissued, never edited'); END;
CREATE TRIGGER tax_2307_receipts_no_update BEFORE UPDATE ON tax_2307_receipts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a 2307 marked received stays received'); END;
