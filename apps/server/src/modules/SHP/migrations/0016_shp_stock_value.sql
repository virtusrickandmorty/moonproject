-- The website shop's own stock in the books (the owner's request, Oct 2026: "does the POS and website comply with our
-- accounting?"): the own-brand pieces on hand are finished goods until sold. At a month end the accountant values them at
-- cost (shp.valuation, SHPV-), against the inventory change in cost of sales, like the TPL clients' stock and the
-- materials count (PLAN D5 INV-COUNT): Dr 1304 / Cr 5109 when the value goes up, Dr 5109 / Cr 1304 when it goes down.
INSERT INTO accounts (code, name, type, normal_side, role_key, party_type, is_header, is_postable, is_cash_place, is_reserved, sort_order) VALUES
('1304', 'Finished goods inventory – website shop', 'asset', 'debit', 'INV_SHOP_STOCK', NULL, 0, 1, 0, 0, 196);

CREATE TABLE shp_valuations (
  document_id      TEXT PRIMARY KEY REFERENCES documents(id),
  value_date       TEXT NOT NULL,
  valued_cents     INTEGER NOT NULL CHECK (valued_cents >= 0),
  ledger_cents     INTEGER NOT NULL,
  adjustment_cents INTEGER NOT NULL CHECK (adjustment_cents = valued_cents - ledger_cents),
  note             TEXT
) STRICT;
CREATE INDEX shp_valuations_date ON shp_valuations(value_date);
CREATE TABLE shp_valuation_lines (
  document_id     TEXT NOT NULL REFERENCES shp_valuations(document_id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  product_id      TEXT NOT NULL REFERENCES shp_products(id),
  name            TEXT NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  value_cents     INTEGER NOT NULL CHECK (value_cents = qty * unit_cost_cents),
  PRIMARY KEY (document_id, line_no)
) STRICT;
CREATE TRIGGER shp_valuations_no_update BEFORE UPDATE ON shp_valuations BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded stock values are cancelled, never edited'); END;
CREATE TRIGGER shp_valuation_lines_no_update BEFORE UPDATE ON shp_valuation_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded stock values are cancelled, never edited'); END;
