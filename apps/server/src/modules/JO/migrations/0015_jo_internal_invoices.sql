-- Internal invoices (the owner's request, Nov 2026): an invoice record's number is from the BIR invoice booklet (digits
-- only, as before) or from the shop's own internal booklet (letters and digits). Each is used once among its own paper.
-- Every invoice record before this is BIR.
ALTER TABLE jo_invoice_records ADD COLUMN paper TEXT NOT NULL DEFAULT 'bir' CHECK (paper IN ('bir', 'internal'));
DROP INDEX jo_invoice_records_number;
CREATE UNIQUE INDEX jo_invoice_records_number ON jo_invoice_records(CAST(invoice_number AS INTEGER), COALESCE(again_of, '')) WHERE paper = 'bir';
CREATE UNIQUE INDEX jo_invoice_records_internal ON jo_invoice_records(UPPER(TRIM(invoice_number)), COALESCE(again_of, '')) WHERE paper = 'internal';
