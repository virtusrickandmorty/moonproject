-- Internal receipts (the owner's request, Nov 2026): a collection's receipt is from the BIR CR booklet (digits only, as
-- before) or from the shop's own internal booklet (letters and digits). A BIR CR is still used once among BIR ones; an
-- internal number once among internal ones, whatever the case of its letters. Every collection before this is BIR.
ALTER TABLE col_collections ADD COLUMN paper TEXT NOT NULL DEFAULT 'bir' CHECK (paper IN ('bir', 'internal'));
DROP TRIGGER col_collections_cr_once;
CREATE TRIGGER col_collections_cr_once BEFORE INSERT ON col_collections
WHEN NEW.paper = 'bir' AND EXISTS (SELECT 1 FROM col_collections c JOIN documents d ON d.id = c.document_id
  WHERE c.paper = 'bir' AND CAST(c.cr_number AS INTEGER) = CAST(NEW.cr_number AS INTEGER) AND d.status = 'posted')
BEGIN SELECT RAISE(ABORT, 'CR_USED: this CR number is on a standing collection'); END;
CREATE TRIGGER col_collections_internal_once BEFORE INSERT ON col_collections
WHEN NEW.paper = 'internal' AND EXISTS (SELECT 1 FROM col_collections c JOIN documents d ON d.id = c.document_id
  WHERE c.paper = 'internal' AND UPPER(TRIM(c.cr_number)) = UPPER(TRIM(NEW.cr_number)) AND d.status = 'posted')
BEGIN SELECT RAISE(ABORT, 'CR_USED: this internal receipt number is on a standing collection'); END;
