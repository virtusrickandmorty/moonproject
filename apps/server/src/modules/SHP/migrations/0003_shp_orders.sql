-- Online orders from the website shop: pay first by the shop's QR, staff check the payment by hand, then the order is
-- confirmed and recorded as a quick sale (QS: invoice + collection, the usual journal). Ready-stock items only.
--   awaiting_payment  placed; its pieces are held until hold_until_ms (24 hours), then it has expired
--   payment_sent      the customer sent a payment reference and proof; held until staff decide
--   confirmed         staff found the money; sale_document_id is the quick sale
--   rejected          staff did not find the money (reason given); the pieces go back on sale
--   cancelled         the customer or staff cancelled before payment
--   ready / completed after confirmation: ready for pickup or sent out, then handed over
CREATE TABLE shp_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'payment_sent', 'confirmed', 'rejected', 'cancelled', 'ready', 'completed')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  fulfilment TEXT NOT NULL CHECK (fulfilment IN ('pickup', 'delivery')),
  address TEXT,
  note TEXT,
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  hold_until_ms INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  payment_reference TEXT,
  payment_sent_at TEXT,
  sale_document_id TEXT REFERENCES documents(id),
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  CHECK (fulfilment = 'pickup' OR address IS NOT NULL)
) STRICT;
CREATE INDEX shp_orders_status ON shp_orders(status, created_ms DESC);
CREATE INDEX shp_orders_sender ON shp_orders(ip, created_ms);

CREATE TABLE shp_order_lines (
  order_id TEXT NOT NULL REFERENCES shp_orders(id),
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  product_id TEXT NOT NULL REFERENCES shp_products(id),
  product_name TEXT NOT NULL,
  size TEXT NOT NULL,
  colour TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  PRIMARY KEY (order_id, line_no)
) STRICT;
CREATE INDEX shp_order_lines_item ON shp_order_lines(product_id, size, colour);
CREATE TRIGGER shp_order_lines_no_update BEFORE UPDATE ON shp_order_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an order''s lines never change'); END;

-- The customer's proof of payment (a screenshot), kept in the database so backups carry it.
CREATE TABLE shp_order_files (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES shp_orders(id),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  sha256 TEXT NOT NULL,
  data BLOB NOT NULL,
  at TEXT NOT NULL
) STRICT;
CREATE TRIGGER shp_order_files_no_update BEFORE UPDATE ON shp_order_files BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: send a new proof'); END;

-- Every step of an order: who moved it (null for the customer) and why.
CREATE TABLE shp_order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES shp_orders(id),
  status TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  note TEXT,
  at TEXT NOT NULL
) STRICT;
CREATE INDEX shp_order_events_order ON shp_order_events(order_id, at);
CREATE TRIGGER shp_order_events_no_update BEFORE UPDATE ON shp_order_events BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: add a new event'); END;

-- How customers pay: the shop's QR image (uploaded in the ERP, never in the code), whose account it is and where the money
-- lands in the books (a cash place). Each save is a new version; the latest one is shown.
CREATE TABLE shp_payment_settings (
  version INTEGER PRIMARY KEY CHECK (version >= 1),
  bank_name TEXT NOT NULL CHECK (length(trim(bank_name)) > 0),
  account_name TEXT NOT NULL CHECK (length(trim(account_name)) > 0),
  account_hint TEXT,
  instructions TEXT,
  cash_place_id INTEGER NOT NULL,
  qr_content_type TEXT NOT NULL CHECK (qr_content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  qr_data BLOB NOT NULL,
  saved_by TEXT NOT NULL REFERENCES users(id),
  saved_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER shp_payment_settings_no_update BEFORE UPDATE ON shp_payment_settings BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: save a new version'); END;
