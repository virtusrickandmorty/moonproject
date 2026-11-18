-- Internal invoices (the owner's request, Nov 2026): the paper a delivery's invoice number is from, as on its quick sale.
-- Every delivery before this is BIR.
ALTER TABLE tpl_deliveries ADD COLUMN paper TEXT NOT NULL DEFAULT 'bir' CHECK (paper IN ('bir', 'internal'));
