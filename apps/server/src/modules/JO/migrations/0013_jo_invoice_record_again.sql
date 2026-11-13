-- Record a cancelled invoice record again (the owner's request, Nov 2026: an invoice record cancelled by mistake, while
-- its paper invoice still stands). The new record keeps the booklet number and names the cancelled one in again_of. The
-- booklet number stays unique per chain: the first record has no again_of, each later one names the record it restores.
ALTER TABLE jo_invoice_records ADD COLUMN again_of TEXT REFERENCES documents(id);
DROP INDEX jo_invoice_records_number;
CREATE UNIQUE INDEX jo_invoice_records_number ON jo_invoice_records(CAST(invoice_number AS INTEGER), COALESCE(again_of, ''));
CREATE UNIQUE INDEX jo_invoice_records_again ON jo_invoice_records(again_of) WHERE again_of IS NOT NULL;
