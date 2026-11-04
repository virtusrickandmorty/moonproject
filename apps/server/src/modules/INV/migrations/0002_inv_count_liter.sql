-- migrate: rebuild-with-foreign-keys-off
-- Liter on a count line (the ERP review, Nov 2026): PUR added the unit in its 0005, and counting a liter supply failed on
-- this table's CHECK. The CHECK is widened by copying the table (same rows, same columns), and its trigger comes back.
CREATE TABLE inv_count_lines_next (
  document_id        TEXT NOT NULL REFERENCES inv_counts(document_id),
  line_no            INTEGER NOT NULL CHECK (line_no >= 1),
  supply_id          TEXT NOT NULL, -- a PUR supply
  unit               TEXT NOT NULL CHECK (unit IN ('yard','meter','kg','liter','roll','pc')),
  qty                INTEGER NOT NULL CHECK (qty >= 0),
  unit_cost_cents    INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  default_cost_cents INTEGER NOT NULL CHECK (default_cost_cents >= 0), -- the latest purchase cost on the count date (ACC-13)
  cost_source        TEXT NOT NULL CHECK (cost_source IN ('bill','po','catalogue')),
  cost_source_number TEXT, -- the BILL- or PO- the default cost came from
  cost_reason        TEXT, -- why the counter changed the cost
  value_cents        INTEGER NOT NULL CHECK (value_cents >= 0),
  PRIMARY KEY (document_id, line_no),
  UNIQUE (document_id, supply_id),
  CHECK ((cost_reason IS NULL) = (unit_cost_cents = default_cost_cents))
) STRICT;
INSERT INTO inv_count_lines_next (document_id, line_no, supply_id, unit, qty, unit_cost_cents, default_cost_cents, cost_source, cost_source_number, cost_reason, value_cents)
SELECT document_id, line_no, supply_id, unit, qty, unit_cost_cents, default_cost_cents, cost_source, cost_source_number, cost_reason, value_cents FROM inv_count_lines;
DROP TABLE inv_count_lines;
ALTER TABLE inv_count_lines_next RENAME TO inv_count_lines;
CREATE TRIGGER inv_count_lines_no_update BEFORE UPDATE ON inv_count_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded inventory counts are cancelled, never edited'); END;
