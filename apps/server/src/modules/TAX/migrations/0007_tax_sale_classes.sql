-- SLSP data (PLAN E12, D8 "Quarterly", K ACC-25): the VAT class of a sale that carries no output VAT.
-- Every sale document posts VAT, so a zero-rated or exempt sale can only come in on a journal voucher that credits
-- sales with no 2301 line. The accountant says which it is, or that it is not a sale at all; nothing is posted.
-- journal_id is the original journal: its cancel (the reversal) takes the same class. A correction is a new row, and
-- the latest row of a journal is the one that counts, so the history stays.
CREATE TABLE tax_sale_classes (
  id         INTEGER PRIMARY KEY,
  journal_id TEXT NOT NULL REFERENCES journals(id),
  vat_class  TEXT NOT NULL CHECK (vat_class IN ('zero_rated', 'exempt', 'not_a_sale')),
  reason     TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX tax_sale_classes_journal ON tax_sale_classes(journal_id, id);
CREATE TRIGGER tax_sale_classes_no_update BEFORE UPDATE ON tax_sale_classes
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a sale''s VAT class gets a new row, never an edit'); END;
