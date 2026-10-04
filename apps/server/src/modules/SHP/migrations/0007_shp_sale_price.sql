-- A product on sale: its regular price before the sale, shown crossed out beside the price (which is what is charged).
-- Null: not on sale. Only for showing on the website; sales always record the price actually charged.
ALTER TABLE shp_products ADD COLUMN regular_price_cents INTEGER CHECK (regular_price_cents IS NULL OR regular_price_cents > price_cents);
