-- Website visitor insights (the owner's request, Oct 2026): what visitors do, under a random id their browser keeps.
-- No name, address, cookie or IP: the kind of device only. Read by Website shop > Visitors (shp.view).
CREATE TABLE shp_events (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  visitor TEXT NOT NULL,
  session TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'product', 'cart', 'wish', 'search', 'category', 'checkout', 'order', 'quote')),
  page TEXT,
  product_id TEXT,
  query TEXT,
  results INTEGER,
  category TEXT,
  source TEXT,
  device TEXT NOT NULL CHECK (device IN ('phone', 'tablet', 'computer'))
) STRICT;
CREATE INDEX shp_events_day ON shp_events(day, kind);
CREATE INDEX shp_events_product ON shp_events(product_id) WHERE product_id IS NOT NULL;
