-- Categories staff keep for the website shop (Jerseys, Polo shirts…), instead of free text on each product.
CREATE TABLE shp_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(name)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- The categories the products already name become the first ones, in the order their products are shown.
INSERT INTO shp_categories (id, name, sort_order, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), MIN(category), ROW_NUMBER() OVER (ORDER BY MIN(sort_order), MIN(category)), MIN(created_at), MIN(created_at)
  FROM shp_products GROUP BY category COLLATE NOCASE;
ALTER TABLE shp_products ADD COLUMN category_id TEXT REFERENCES shp_categories(id);
UPDATE shp_products SET category_id = (SELECT c.id FROM shp_categories c WHERE c.name = shp_products.category COLLATE NOCASE);

-- Finished pieces of the shop's own brand coming in or counted (pieces only: the books stay periodic, PLAN D2 1302/5109).
-- Pieces on hand = these moves + the pieces on recorded sales (qs_sale_lines, negative); a cancelled sale gives its back.
CREATE TABLE shp_stock_moves (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES shp_products(id),
  size TEXT NOT NULL CHECK (size IN ('XS', 'S', 'M', 'L', 'XL', '2XL', '3XL')),
  colour TEXT NOT NULL CHECK (length(trim(colour)) > 0),
  qty INTEGER NOT NULL CHECK (qty <> 0),
  reason TEXT NOT NULL CHECK (reason IN ('stock_in', 'count')),
  note TEXT,
  user_id TEXT NOT NULL REFERENCES users(id),
  at TEXT NOT NULL
) STRICT;
CREATE INDEX shp_stock_moves_variant ON shp_stock_moves(product_id, size, colour);
CREATE TRIGGER shp_stock_moves_no_update BEFORE UPDATE ON shp_stock_moves BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: record a new move'); END;
