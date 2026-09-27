-- A collection may also pay quick sales (QS invoice records, PLAN E5 "applications: JOs/invoice records", D5 QS-SALE).
-- The AR line names the sale (journal ref), so what is still owed on a sale is read from the ledger.
CREATE TABLE col_sale_applications (
  document_id  TEXT NOT NULL REFERENCES col_collections(document_id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  sale_id      TEXT NOT NULL REFERENCES documents(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (document_id, line_no),
  UNIQUE (document_id, sale_id)
) STRICT;
CREATE INDEX col_sale_applications_sale ON col_sale_applications(sale_id);

CREATE TRIGGER col_sale_applications_no_update BEFORE UPDATE ON col_sale_applications
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded collections are cancelled and reissued, never edited'); END;
