-- VAT withheld by government buyers (PLAN D4.6, D5 COL-RCV): typed from the 2307 next to the CWT, creditable (1404).
-- A buyer that withholds VAT withholds CWT on the same 2307, so VAT withheld comes only with a CWT amount.
-- From here on: documents.total_cents = Σ tenders + CWT + VAT withheld.
ALTER TABLE col_collections ADD COLUMN vat_withheld_cents INTEGER NOT NULL DEFAULT 0
  CHECK (vat_withheld_cents >= 0 AND (vat_withheld_cents = 0 OR cwt_cents > 0));
