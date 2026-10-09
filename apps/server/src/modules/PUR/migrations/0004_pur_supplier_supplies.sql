-- Which supplies a supplier sells (the owner's request, Oct 9, 2026): linked on the supplier's page, so a purchase order
-- from that supplier lists those supplies first. Master data: a link is switched off (is_active 0), never deleted.
CREATE TABLE pur_supplier_supplies (
  supplier_id TEXT NOT NULL REFERENCES pur_suppliers(id),
  supply_id   TEXT NOT NULL REFERENCES pur_supplies(id),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (supplier_id, supply_id)
) STRICT;
CREATE INDEX pur_supplier_supplies_supply ON pur_supplier_supplies(supply_id);
