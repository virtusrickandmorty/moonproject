-- Internal invoices (the owner's request, Nov 2026): a quick sale's number is from the BIR invoice booklet (digits only,
-- as before) or from the shop's own internal booklet (letters and digits). Each is used once among its own paper.
-- Every quick sale before this is BIR.
ALTER TABLE qs_sales ADD COLUMN paper TEXT NOT NULL DEFAULT 'bir' CHECK (paper IN ('bir', 'internal'));
DROP INDEX qs_sales_invoice;
CREATE UNIQUE INDEX qs_sales_invoice ON qs_sales(CAST(invoice_number AS INTEGER)) WHERE paper = 'bir';
CREATE UNIQUE INDEX qs_sales_internal ON qs_sales(UPPER(TRIM(invoice_number))) WHERE paper = 'internal';
