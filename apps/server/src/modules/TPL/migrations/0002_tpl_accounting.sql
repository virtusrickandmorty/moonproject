-- TPL in the books (the owner's request, 22 Oct 2026: "how do you handle the TPL service in the accounting side").
-- 1. The pieces held for the clients are Virtus's own finished goods until delivered: at a month end the accountant
--    values them at cost (tpl.valuation, TPLV-), against the inventory change in cost of sales, like the materials
--    count (PLAN D5 INV-COUNT): Dr 1303 / Cr 5109 when the value goes up, Dr 5109 / Cr 1303 when it goes down.
-- 2. A delivery's fee is delivery income, not repairs and alterations: the delivery receipt moves the fee's NET from
--    4103 (where its invoice, a quick sale, credits a service line) to 4104 in the same action.
INSERT INTO accounts (code, name, type, normal_side, role_key, party_type, is_header, is_postable, is_cash_place, is_reserved, sort_order) VALUES
('1303', 'Finished goods inventory – TPL clients'' stock', 'asset', 'debit', 'INV_TPL_STOCK', NULL, 0, 1, 0, 0, 195),
('4104', 'Service income – delivery fees', 'revenue', 'credit', 'SALES_DELIVERY', 'customer', 0, 1, 0, 0, 845);

-- TPL stock value (TPLV-): the pieces on hand on a month end, each at its cost per piece, and the adjustment of 1303.
CREATE TABLE tpl_valuations (
  document_id      TEXT PRIMARY KEY REFERENCES documents(id),
  value_date       TEXT NOT NULL,
  valued_cents     INTEGER NOT NULL CHECK (valued_cents >= 0),
  ledger_cents     INTEGER NOT NULL,
  adjustment_cents INTEGER NOT NULL CHECK (adjustment_cents = valued_cents - ledger_cents),
  note             TEXT
) STRICT;
CREATE INDEX tpl_valuations_date ON tpl_valuations(value_date);
CREATE TABLE tpl_valuation_lines (
  document_id     TEXT NOT NULL REFERENCES tpl_valuations(document_id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  item_id         TEXT NOT NULL REFERENCES tpl_items(id),
  customer_name   TEXT NOT NULL,
  description     TEXT NOT NULL,
  size            TEXT NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  value_cents     INTEGER NOT NULL CHECK (value_cents = qty * unit_cost_cents),
  PRIMARY KEY (document_id, line_no)
) STRICT;
CREATE TRIGGER tpl_valuations_no_update BEFORE UPDATE ON tpl_valuations BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded stock values are cancelled, never edited'); END;
CREATE TRIGGER tpl_valuation_lines_no_update BEFORE UPDATE ON tpl_valuation_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded stock values are cancelled, never edited'); END;
