-- migrate: rebuild-with-foreign-keys-off
-- Liter as a unit of supplies (the owner's request, Oct 9, 2026), for inks, dyes, glue and the like. The unit CHECK is
-- widened by copying the table (same rows, same columns); the tables that point to supplies keep pointing to the copy,
-- and the migration runner checks every link before keeping it.
CREATE TABLE pur_supplies_next (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  unit                 TEXT NOT NULL CHECK (unit IN ('yard', 'meter', 'kg', 'liter', 'roll', 'pc')),
  category             TEXT NOT NULL CHECK (category IN ('materials', 'ready_made')),
  last_purchase_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (last_purchase_cost_cents >= 0),
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;
INSERT INTO pur_supplies_next (id, name, unit, category, last_purchase_cost_cents, is_active, version, created_at, updated_at)
SELECT id, name, unit, category, last_purchase_cost_cents, is_active, version, created_at, updated_at FROM pur_supplies;
DROP TABLE pur_supplies;
ALTER TABLE pur_supplies_next RENAME TO pur_supplies;
