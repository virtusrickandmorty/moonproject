-- A quick sale on terms (the owner's request, Oct 2026: TPL deliveries are invoiced and collected after the client's terms):
-- the days given and the due date they make, so the sale ages from its due date. A counter sale has no row (due at once).
-- Insert-only, like the sale.
CREATE TABLE qs_sale_terms (
  document_id TEXT PRIMARY KEY REFERENCES qs_sales(document_id),
  terms_days  INTEGER NOT NULL CHECK (terms_days BETWEEN 1 AND 365),
  due_date    TEXT NOT NULL
) STRICT;

CREATE TRIGGER qs_sale_terms_no_update BEFORE UPDATE ON qs_sale_terms
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded quick sales are cancelled and reissued, never edited'); END;
