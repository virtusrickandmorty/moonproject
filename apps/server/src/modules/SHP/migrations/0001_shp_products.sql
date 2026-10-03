-- The garments shown in the website's shop. A showcase, not the price list: a "from" price per piece, colours, sizes and
-- a photo. Nothing is deleted: a product is hidden (is_active = 0), and each save keeps its lists under a new version.
CREATE TABLE shp_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL CHECK (length(trim(category)) > 0),
  shape TEXT NOT NULL CHECK (shape IN ('tee', 'polo', 'jersey', 'jacket', 'hoodie', 'shorts')),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  made_to_order INTEGER NOT NULL CHECK (made_to_order IN (0, 1)),
  min_qty INTEGER NOT NULL CHECK (min_qty >= 1),
  lead_days INTEGER NOT NULL CHECK (lead_days >= 0),
  badge TEXT,
  summary TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  photo_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX shp_products_shown ON shp_products(is_active, sort_order, name);

-- The lists of each saved version; the product's current version picks the ones shown.
CREATE TABLE shp_product_colours (
  product_id TEXT NOT NULL REFERENCES shp_products(id),
  version INTEGER NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  hex TEXT NOT NULL CHECK (hex GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  PRIMARY KEY (product_id, version, position)
) STRICT;
CREATE TABLE shp_product_sizes (
  product_id TEXT NOT NULL REFERENCES shp_products(id),
  version INTEGER NOT NULL,
  position INTEGER NOT NULL,
  size TEXT NOT NULL CHECK (size IN ('XS', 'S', 'M', 'L', 'XL', '2XL', '3XL')),
  PRIMARY KEY (product_id, version, position)
) STRICT;
CREATE TABLE shp_product_features (
  product_id TEXT NOT NULL REFERENCES shp_products(id),
  version INTEGER NOT NULL,
  position INTEGER NOT NULL,
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  PRIMARY KEY (product_id, version, position)
) STRICT;
CREATE TRIGGER shp_product_colours_no_update BEFORE UPDATE ON shp_product_colours BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: save a new version'); END;
CREATE TRIGGER shp_product_sizes_no_update BEFORE UPDATE ON shp_product_sizes BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: save a new version'); END;
CREATE TRIGGER shp_product_features_no_update BEFORE UPDATE ON shp_product_features BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: save a new version'); END;

-- Photos kept in the database, so backups carry them; a product points at its current one.
CREATE TABLE shp_photos (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES shp_products(id),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  sha256 TEXT NOT NULL,
  data BLOB NOT NULL,
  added_by TEXT NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER shp_photos_no_update BEFORE UPDATE ON shp_photos BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: upload a new photo'); END;
