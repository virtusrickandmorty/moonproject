-- A ready-made line may name the website shop product, size and colour it sold (the POS and online orders do), so the
-- shop's pieces on hand go down with every recorded sale and come back when the sale is cancelled. Pieces only: the
-- journal is unchanged (periodic inventory, PLAN D2).
ALTER TABLE qs_sale_lines ADD COLUMN product_id TEXT;
ALTER TABLE qs_sale_lines ADD COLUMN size TEXT;
ALTER TABLE qs_sale_lines ADD COLUMN colour TEXT;
CREATE INDEX qs_sale_lines_product ON qs_sale_lines(product_id, size, colour) WHERE product_id IS NOT NULL;
