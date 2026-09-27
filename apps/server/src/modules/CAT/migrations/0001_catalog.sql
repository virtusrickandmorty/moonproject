CREATE TABLE cat_items (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('made_to_order_garment', 'service', 'ready_made_item')),
  garment_type TEXT,
  unit TEXT NOT NULL CHECK (unit IN ('pc', 'set')),
  set_components INTEGER NOT NULL DEFAULT 1 CHECK (set_components >= 1),
  revenue_role TEXT NOT NULL CHECK (revenue_role IN ('SALES_MTO', 'SALES_SERVICE', 'SALES_RTW')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(code)) > 0 AND length(trim(name)) > 0),
  CHECK (unit = 'set' OR set_components = 1),
  CHECK ((class = 'made_to_order_garment' AND revenue_role = 'SALES_MTO' AND garment_type IS NOT NULL)
    OR (class = 'service' AND revenue_role = 'SALES_SERVICE' AND garment_type IS NULL)
    OR (class = 'ready_made_item' AND revenue_role = 'SALES_RTW' AND garment_type IS NULL))
) STRICT;

CREATE TABLE cat_prices (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES cat_items(id),
  effective_from TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  min_qty INTEGER NOT NULL CHECK (min_qty > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version = 1),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE (item_id, effective_from, min_qty)
) STRICT;
CREATE INDEX cat_prices_lookup ON cat_prices(item_id, effective_from DESC, min_qty DESC);
CREATE TRIGGER cat_prices_no_update BEFORE UPDATE ON cat_prices
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: create a new effective-dated price'); END;

CREATE TABLE cat_discount_policies (
  version INTEGER PRIMARY KEY CHECK (version >= 1),
  effective_from TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  threshold_bps INTEGER NOT NULL CHECK (threshold_bps BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id)
) STRICT;
INSERT INTO cat_discount_policies (version, effective_from, threshold_bps, created_at)
VALUES (1, '0001-01-01', 1000, '0001-01-01T00:00:00+08:00');
CREATE TRIGGER cat_discount_policies_no_update BEFORE UPDATE ON cat_discount_policies
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: insert a new discount policy'); END;
