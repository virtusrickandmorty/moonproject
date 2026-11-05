-- A CR number from a cancelled collection can be used again (the owner's rule, Nov 2026): an entry cancelled or edited does
-- not mean the paper receipt was spoiled. Two standing collections still cannot share one, and the database says so too.
DROP INDEX col_collections_cr;
CREATE INDEX col_collections_cr ON col_collections(CAST(cr_number AS INTEGER));
CREATE TRIGGER col_collections_cr_once BEFORE INSERT ON col_collections
WHEN EXISTS (SELECT 1 FROM col_collections c JOIN documents d ON d.id = c.document_id WHERE CAST(c.cr_number AS INTEGER) = CAST(NEW.cr_number AS INTEGER) AND d.status = 'posted')
BEGIN SELECT RAISE(ABORT, 'CR_USED: this CR number is on a standing collection'); END;
