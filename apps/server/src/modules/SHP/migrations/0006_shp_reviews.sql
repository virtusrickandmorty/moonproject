-- Ratings and reviews from buyers: once an online order is completed, its buyer (through the order's secret link) can rate
-- each product on it once, 1 to 5 stars with a few words. The website shows them on the product and on the About us page,
-- under the buyer's first name and initial. Nothing is deleted: staff hide a review (with a reason) and can show it again.
CREATE TABLE shp_reviews (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES shp_orders(id),
  product_id TEXT NOT NULL REFERENCES shp_products(id),
  product_name TEXT NOT NULL,      -- as it was ordered
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  shown_name TEXT NOT NULL CHECK (length(trim(shown_name)) > 0), -- "Juan D.", never the full name
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  hidden_reason TEXT,
  hidden_by TEXT REFERENCES users(id),
  hidden_at TEXT,
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (order_id, product_id)
) STRICT;
CREATE INDEX shp_reviews_product ON shp_reviews(product_id, created_at DESC);
-- What the buyer wrote never changes; only hiding and showing it does.
CREATE TRIGGER shp_reviews_words_no_update BEFORE UPDATE OF order_id, product_id, product_name, rating, title, body, shown_name, created_at ON shp_reviews
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a review''s words never change; hide it instead'); END;
