CREATE TABLE pur_purchase_orders (
  document_id          TEXT PRIMARY KEY REFERENCES documents(id),
  supplier_id          TEXT NOT NULL REFERENCES pur_suppliers(id),
  expected_date        TEXT
) STRICT;
CREATE TRIGGER pur_po_no_update BEFORE UPDATE ON pur_purchase_orders
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted purchase orders are cancelled, never edited'); END;
CREATE TRIGGER pur_po_no_delete BEFORE DELETE ON pur_purchase_orders
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted purchase orders are cancelled, never deleted'); END;

CREATE TABLE pur_po_lines (
  id                   TEXT PRIMARY KEY,
  document_id          TEXT NOT NULL REFERENCES documents(id),
  supply_id            TEXT NOT NULL REFERENCES pur_supplies(id),
  qty                  INTEGER NOT NULL CHECK (qty > 0),
  unit_cost_cents      INTEGER NOT NULL CHECK (unit_cost_cents >= 0)
) STRICT;
CREATE TRIGGER pur_po_lines_no_delete BEFORE DELETE ON pur_po_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted purchase order lines are never deleted'); END;
