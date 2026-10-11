-- Shop work (the owner's request, Oct 2026): a job order made for the website shop's own stock, through the production
-- board like any other: make (a restock of new pieces), rework (pieces taken off sale to be fixed) or change (pieces
-- altered into a website product: from the shop's stock, from a job order's leftovers, or from other pieces). Finished
-- pieces go into the shop's stock from the board; only then are they for sale. Pieces only, no journal (PLAN D2).

-- The shop's own customer, on whose name its work orders are made (created on the first one).
CREATE TABLE shp_work_customer (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  customer_id TEXT NOT NULL REFERENCES cus_customers(id)
) STRICT;

CREATE TABLE shp_work (
  job_order_id TEXT PRIMARY KEY REFERENCES documents(id),
  kind         TEXT NOT NULL CHECK (kind IN ('make', 'rework', 'change')),
  at           TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id)
) STRICT;

-- Each job order line: the website item it becomes; for rework and change, where its pieces come from.
CREATE TABLE shp_work_lines (
  job_order_id    TEXT NOT NULL REFERENCES shp_work(job_order_id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  product_id      TEXT NOT NULL REFERENCES shp_products(id),
  size            TEXT NOT NULL,
  colour          TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('new', 'shop_stock', 'job_order', 'other')),
  from_product_id TEXT REFERENCES shp_products(id),
  from_size       TEXT,
  from_colour     TEXT,
  source_note     TEXT,
  PRIMARY KEY (job_order_id, line_no),
  CHECK ((source = 'shop_stock') = (from_product_id IS NOT NULL AND from_size IS NOT NULL AND from_colour IS NOT NULL)),
  CHECK (source NOT IN ('job_order', 'other') OR length(trim(source_note)) >= 3)
) STRICT;

-- Pieces moved by shop work, insert-only: taken off sale (rework, change from stock; negative), given back to sale when
-- not worked on after all (positive), and finished pieces put into stock (positive). They count in the shop's stock.
CREATE TABLE shp_work_moves (
  id           TEXT PRIMARY KEY,
  job_order_id TEXT NOT NULL REFERENCES shp_work(job_order_id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  product_id   TEXT NOT NULL REFERENCES shp_products(id),
  size         TEXT NOT NULL,
  colour       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('taken_off', 'given_back', 'put_in')),
  qty          INTEGER NOT NULL CHECK ((kind = 'taken_off' AND qty < 0) OR (kind <> 'taken_off' AND qty > 0)),
  at           TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX shp_work_moves_item ON shp_work_moves (product_id, size, colour);
CREATE INDEX shp_work_moves_line ON shp_work_moves (job_order_id, line_no);

CREATE TRIGGER shp_work_customer_no_update BEFORE UPDATE ON shp_work_customer BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: the shop customer is set once'); END;
CREATE TRIGGER shp_work_customer_no_delete BEFORE DELETE ON shp_work_customer BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: the shop customer is set once'); END;
CREATE TRIGGER shp_work_no_update BEFORE UPDATE ON shp_work BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: shop work marks are insert-only'); END;
CREATE TRIGGER shp_work_no_delete BEFORE DELETE ON shp_work BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: shop work marks are insert-only'); END;
CREATE TRIGGER shp_work_lines_no_update BEFORE UPDATE ON shp_work_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: shop work marks are insert-only'); END;
CREATE TRIGGER shp_work_lines_no_delete BEFORE DELETE ON shp_work_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: shop work marks are insert-only'); END;
CREATE TRIGGER shp_work_moves_no_update BEFORE UPDATE ON shp_work_moves BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: record a new move'); END;
CREATE TRIGGER shp_work_moves_no_delete BEFORE DELETE ON shp_work_moves BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: record a new move'); END;
