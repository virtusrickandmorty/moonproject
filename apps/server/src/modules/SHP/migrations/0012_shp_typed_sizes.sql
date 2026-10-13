-- Sizes typed like the colours (the owner's request, Oct 2026): any size a product comes in (e.g. 4, 6, 8 for kids,
-- 28, 30 for pants, Free size), not only XS to 3XL. SQLite cannot change a CHECK in place, so the two tables that named
-- the sizes are rebuilt with every row kept as it was (0001 and 0002 stay as they ran).
CREATE TABLE shp_product_sizes_new (
  product_id TEXT NOT NULL REFERENCES shp_products(id),
  version INTEGER NOT NULL,
  position INTEGER NOT NULL,
  size TEXT NOT NULL CHECK (length(trim(size)) BETWEEN 1 AND 20),
  PRIMARY KEY (product_id, version, position)
) STRICT;
INSERT INTO shp_product_sizes_new (product_id, version, position, size) SELECT product_id, version, position, size FROM shp_product_sizes;
DROP TABLE shp_product_sizes;
ALTER TABLE shp_product_sizes_new RENAME TO shp_product_sizes;
CREATE TRIGGER shp_product_sizes_no_update BEFORE UPDATE ON shp_product_sizes BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: save a new version'); END;

CREATE TABLE shp_stock_moves_new (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES shp_products(id),
  size TEXT NOT NULL CHECK (length(trim(size)) BETWEEN 1 AND 20),
  colour TEXT NOT NULL CHECK (length(trim(colour)) > 0),
  qty INTEGER NOT NULL CHECK (qty <> 0),
  reason TEXT NOT NULL CHECK (reason IN ('stock_in', 'count')),
  note TEXT,
  user_id TEXT NOT NULL REFERENCES users(id),
  at TEXT NOT NULL
) STRICT;
INSERT INTO shp_stock_moves_new (id, product_id, size, colour, qty, reason, note, user_id, at)
  SELECT id, product_id, size, colour, qty, reason, note, user_id, at FROM shp_stock_moves;
DROP TABLE shp_stock_moves;
ALTER TABLE shp_stock_moves_new RENAME TO shp_stock_moves;
CREATE INDEX shp_stock_moves_variant ON shp_stock_moves(product_id, size, colour);
CREATE TRIGGER shp_stock_moves_no_update BEFORE UPDATE ON shp_stock_moves BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: record a new move'); END;
