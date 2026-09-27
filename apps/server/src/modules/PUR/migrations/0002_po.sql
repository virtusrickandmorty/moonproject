CREATE TABLE pur_purchase_orders (
  document_id          TEXT PRIMARY KEY REFERENCES documents(id),
  supplier_id          TEXT NOT NULL REFERENCES pur_suppliers(id),
  expected_date        TEXT
) STRICT;

CREATE TABLE pur_po_lines (
  document_id          TEXT NOT NULL REFERENCES documents(id),
  line_no              INTEGER NOT NULL CHECK (line_no > 0),
  supply_id            TEXT NOT NULL REFERENCES pur_supplies(id),
  qty                  INTEGER NOT NULL CHECK (qty > 0),
  unit_cost_cents      INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  PRIMARY KEY (document_id, line_no)
) STRICT;
