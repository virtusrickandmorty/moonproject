-- Inventory count (INVC-, PLAN D5 INV-COUNT, E9, golden G-22): one category counted at cost on a month end, against the
-- GL balance of its inventory account (1301 or 1302) on that date. Rows are insert-only: a count is cancelled, never edited.
CREATE TABLE inv_counts (
  document_id      TEXT PRIMARY KEY REFERENCES documents(id),
  category         TEXT NOT NULL CHECK (category IN ('materials','ready_made')),
  count_date       TEXT NOT NULL, -- the document's business date
  counted_cents    INTEGER NOT NULL CHECK (counted_cents >= 0),
  ledger_cents     INTEGER NOT NULL, -- the inventory account's balance on the count date, before this count
  adjustment_cents INTEGER NOT NULL CHECK (adjustment_cents <> 0),
  note             TEXT,
  CHECK (adjustment_cents = counted_cents - ledger_cents)
) STRICT;
CREATE INDEX inv_counts_category_date ON inv_counts(category, count_date);

-- One row per supply counted. The quantity is in milli-units for yard, meter and kg, whole for roll and pc (PLAN C5).
CREATE TABLE inv_count_lines (
  document_id        TEXT NOT NULL REFERENCES inv_counts(document_id),
  line_no            INTEGER NOT NULL CHECK (line_no >= 1),
  supply_id          TEXT NOT NULL, -- a PUR supply
  unit               TEXT NOT NULL CHECK (unit IN ('yard','meter','kg','roll','pc')),
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

CREATE TRIGGER inv_counts_no_update BEFORE UPDATE ON inv_counts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded inventory counts are cancelled, never edited'); END;
CREATE TRIGGER inv_count_lines_no_update BEFORE UPDATE ON inv_count_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded inventory counts are cancelled, never edited'); END;
