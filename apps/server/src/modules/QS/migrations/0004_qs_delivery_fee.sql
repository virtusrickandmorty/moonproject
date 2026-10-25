-- A delivery fee on a quick sale is delivery income (4104), not repairs and alterations (the owner's request, Oct 2026:
-- the website's online orders and their delivery fee). A service line may be marked as the delivery fee; the sale keeps
-- the fee's NET (its share of the service sales, as the invoice splits it) beside the service sales it is part of.
ALTER TABLE qs_sale_lines ADD COLUMN delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee IN (0, 1));
ALTER TABLE qs_sales ADD COLUMN sales_delivery_cents INTEGER NOT NULL DEFAULT 0 CHECK (sales_delivery_cents >= 0);
