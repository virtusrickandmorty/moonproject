-- Quick sale (PLAN E6, D5 QS-SALE): a walk-in sale recorded as an invoice record from the manual BIR invoice, paid at
-- the counter by a COL collection in the same action. Insert-only: a mistake is cancelled and reissued.

CREATE TABLE qs_sales (
  document_id         TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id         TEXT NOT NULL,
  customer_name       TEXT NOT NULL, -- as it read when recorded
  invoice_number      TEXT NOT NULL, -- manual BIR invoice number as typed; used once, ever, JO invoice records included
  vat_rate_bp         INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  list_cents          INTEGER NOT NULL CHECK (list_cents >= 0),
  discount_cents      INTEGER NOT NULL CHECK (discount_cents >= 0),
  gross_cents         INTEGER NOT NULL CHECK (gross_cents > 0 AND gross_cents = list_cents - discount_cents),
  vat_cents           INTEGER NOT NULL CHECK (vat_cents >= 0),
  discount_net_cents  INTEGER NOT NULL CHECK (discount_net_cents >= 0),
  sales_mto_cents     INTEGER NOT NULL CHECK (sales_mto_cents >= 0),
  sales_rtw_cents     INTEGER NOT NULL CHECK (sales_rtw_cents >= 0),
  sales_service_cents INTEGER NOT NULL CHECK (sales_service_cents >= 0),
  note                TEXT,
  CHECK (sales_mto_cents + sales_rtw_cents + sales_service_cents = gross_cents - vat_cents + discount_net_cents)
) STRICT;
-- A cancelled invoice keeps its number ("cancelled, all copies kept", D6), and "0502" and "502" are the same paper.
CREATE UNIQUE INDEX qs_sales_invoice ON qs_sales(CAST(invoice_number AS INTEGER));
CREATE INDEX qs_sales_customer ON qs_sales(customer_id);

-- What was sold: any item or service, typed with its class (sales account, D2).
CREATE TABLE qs_sale_lines (
  document_id      TEXT NOT NULL REFERENCES qs_sales(document_id),
  line_no          INTEGER NOT NULL CHECK (line_no >= 1),
  kind             TEXT NOT NULL CHECK (kind IN ('made_to_order','service','ready_made')),
  description      TEXT NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0), -- VAT-inclusive
  discount_cents   INTEGER NOT NULL CHECK (discount_cents >= 0),
  amount_cents     INTEGER NOT NULL CHECK (amount_cents >= 0 AND amount_cents = qty * unit_price_cents - discount_cents),
  PRIMARY KEY (document_id, line_no)
) STRICT;

CREATE TRIGGER qs_sales_no_update BEFORE UPDATE ON qs_sales
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded quick sales are cancelled and reissued, never edited'); END;
CREATE TRIGGER qs_sale_lines_no_update BEFORE UPDATE ON qs_sale_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded quick sales are cancelled and reissued, never edited'); END;
