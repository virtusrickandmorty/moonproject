CREATE TABLE quo_quotations (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  prospect_name TEXT,
  contact TEXT,
  valid_for_days INTEGER NOT NULL CHECK (valid_for_days BETWEEN 1 AND 365),
  valid_until TEXT NOT NULL,
  terms_text TEXT,
  notes TEXT,
  document_discount_cents INTEGER NOT NULL CHECK (document_discount_cents >= 0),
  discount_reason TEXT,
  CHECK ((customer_id IS NULL) <> (prospect_name IS NULL))
) STRICT;
CREATE TRIGGER quo_quotations_no_update BEFORE UPDATE ON quo_quotations
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: cancel and reissue a quotation'); END;

CREATE TABLE quo_lines (
  document_id TEXT NOT NULL REFERENCES quo_quotations(document_id),
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  item_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  description TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit TEXT NOT NULL CHECK (unit IN ('pc', 'set')),
  list_unit_price_cents INTEGER NOT NULL CHECK (list_unit_price_cents >= 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  override_reason TEXT,
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  discount_reason TEXT,
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  PRIMARY KEY (document_id, line_no)
) STRICT;
CREATE TRIGGER quo_lines_no_update BEFORE UPDATE ON quo_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: cancel and reissue a quotation'); END;
