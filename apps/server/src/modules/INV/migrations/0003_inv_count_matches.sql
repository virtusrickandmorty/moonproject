-- migrate: rebuild-with-foreign-keys-off
-- A count that matches the books is a count (the ERP review, Nov 2026): it posts nothing, and the month's checklist shows
-- it done. The "not zero" CHECK goes by copying the table (same rows, same columns); its index and trigger come back.
CREATE TABLE inv_counts_next (
  document_id      TEXT PRIMARY KEY REFERENCES documents(id),
  category         TEXT NOT NULL CHECK (category IN ('materials','ready_made')),
  count_date       TEXT NOT NULL, -- the document's business date
  counted_cents    INTEGER NOT NULL CHECK (counted_cents >= 0),
  ledger_cents     INTEGER NOT NULL, -- the inventory account's balance on the count date, before this count
  adjustment_cents INTEGER NOT NULL,
  note             TEXT,
  CHECK (adjustment_cents = counted_cents - ledger_cents)
) STRICT;
INSERT INTO inv_counts_next (document_id, category, count_date, counted_cents, ledger_cents, adjustment_cents, note)
SELECT document_id, category, count_date, counted_cents, ledger_cents, adjustment_cents, note FROM inv_counts;
DROP TABLE inv_counts;
ALTER TABLE inv_counts_next RENAME TO inv_counts;
CREATE INDEX inv_counts_category_date ON inv_counts(category, count_date);
CREATE TRIGGER inv_counts_no_update BEFORE UPDATE ON inv_counts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded inventory counts are cancelled, never edited'); END;
