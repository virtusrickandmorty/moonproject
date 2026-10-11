-- TPL Services (the owner's request, 11 Oct 2026; design "TPL Services module: design"): Virtus makes a client's items ahead,
-- keeps them, and delivers when the client calls. The pieces stay Virtus's until delivered; each delivery is a sale on
-- the client's terms (its invoice is a quick sale on terms, QS). Stock is counted in pieces only: inventory is periodic
-- (PLAN D2), so nothing here posts a journal except the delivery's invoice.

-- A client's stock program: its terms and credit limit. Master data: changed with a version and an audit row, never deleted.
CREATE TABLE tpl_programs (
  id                 TEXT PRIMARY KEY,
  customer_id        TEXT NOT NULL UNIQUE,
  terms_days         INTEGER NOT NULL CHECK (terms_days BETWEEN 1 AND 365),
  credit_limit_cents INTEGER NOT NULL CHECK (credit_limit_cents >= 0), -- 0 = no limit
  note               TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  updated_at         TEXT NOT NULL
) STRICT;

-- The items held for a client: what, which size, the price per piece (VAT-inclusive) and when to restock.
CREATE TABLE tpl_items (
  id            TEXT PRIMARY KEY,
  program_id    TEXT NOT NULL REFERENCES tpl_programs(id),
  kind          TEXT NOT NULL CHECK (kind IN ('made_to_order', 'ready_made')),
  description   TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  size          TEXT NOT NULL DEFAULT '' CHECK (length(size) <= 20),
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  reorder_level INTEGER NOT NULL CHECK (reorder_level >= 0),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX tpl_items_name ON tpl_items(program_id, description COLLATE NOCASE, size COLLATE NOCASE);

-- A job order made for a client's stock, and which item each of its lines makes. Insert-only.
CREATE TABLE tpl_restocks (
  job_order_id TEXT PRIMARY KEY REFERENCES documents(id),
  program_id   TEXT NOT NULL REFERENCES tpl_programs(id),
  at           TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE TABLE tpl_restock_lines (
  job_order_id TEXT NOT NULL REFERENCES tpl_restocks(job_order_id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  item_id      TEXT NOT NULL REFERENCES tpl_items(id),
  PRIMARY KEY (job_order_id, line_no)
) STRICT;

-- Pieces coming into a client's stock, insert-only: in = put into stock from a restock job order; count = a count
-- adjustment (with a reason, either way). On hand = these, less the pieces on recorded (not cancelled) deliveries, so a
-- cancelled delivery's pieces are back by themselves.
CREATE TABLE tpl_stock_moves (
  id           INTEGER PRIMARY KEY,
  item_id      TEXT NOT NULL REFERENCES tpl_items(id),
  kind         TEXT NOT NULL CHECK (kind IN ('in', 'count')),
  qty          INTEGER NOT NULL CHECK (qty <> 0 AND (kind = 'count' OR qty > 0)),
  document_id  TEXT REFERENCES documents(id), -- the restock job order or the delivery
  line_no      INTEGER,                       -- the job order line, for 'in'
  reason       TEXT,
  at           TEXT NOT NULL,
  business_date TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id),
  CHECK (kind <> 'count' OR length(reason) >= 10),
  CHECK (kind <> 'in' OR (document_id IS NOT NULL AND line_no IS NOT NULL))
) STRICT;
CREATE INDEX tpl_stock_moves_item ON tpl_stock_moves(item_id);
CREATE INDEX tpl_stock_moves_doc ON tpl_stock_moves(document_id);

-- Delivery receipt (DR-): pieces taken out of a client's stock, with the invoice it carries (a quick sale on terms).
CREATE TABLE tpl_deliveries (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  program_id      TEXT NOT NULL REFERENCES tpl_programs(id),
  customer_id     TEXT NOT NULL,
  customer_name   TEXT NOT NULL,
  invoice_number  TEXT NOT NULL,
  terms_days      INTEGER NOT NULL CHECK (terms_days BETWEEN 1 AND 365),
  due_date        TEXT NOT NULL,
  goods_cents     INTEGER NOT NULL CHECK (goods_cents >= 0),
  fee_cents       INTEGER NOT NULL CHECK (fee_cents >= 0), -- the delivery fee, a service line on the invoice
  delivered_by    TEXT NOT NULL,
  received_by     TEXT,
  tracking        TEXT,
  override_reason TEXT, -- over the credit limit or with an overdue invoice: why it went anyway
  note            TEXT
) STRICT;
CREATE INDEX tpl_deliveries_program ON tpl_deliveries(program_id);
CREATE TABLE tpl_delivery_lines (
  document_id      TEXT NOT NULL REFERENCES tpl_deliveries(document_id),
  line_no          INTEGER NOT NULL CHECK (line_no >= 1),
  item_id          TEXT NOT NULL REFERENCES tpl_items(id),
  description      TEXT NOT NULL,
  size             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  amount_cents     INTEGER NOT NULL CHECK (amount_cents = qty * unit_price_cents),
  PRIMARY KEY (document_id, line_no)
) STRICT;
-- The invoice a delivery carries, written in the same action right after it. Insert-only.
CREATE TABLE tpl_delivery_invoices (
  document_id TEXT PRIMARY KEY REFERENCES tpl_deliveries(document_id),
  sale_id     TEXT NOT NULL UNIQUE REFERENCES documents(id)
) STRICT;

CREATE TRIGGER tpl_restocks_no_update BEFORE UPDATE ON tpl_restocks BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: restock marks are insert-only'); END;
CREATE TRIGGER tpl_restock_lines_no_update BEFORE UPDATE ON tpl_restock_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: restock marks are insert-only'); END;
CREATE TRIGGER tpl_stock_moves_no_update BEFORE UPDATE ON tpl_stock_moves BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: stock moves are insert-only; a correction is a new move'); END;
CREATE TRIGGER tpl_deliveries_no_update BEFORE UPDATE ON tpl_deliveries BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded deliveries are cancelled, never edited'); END;
CREATE TRIGGER tpl_delivery_lines_no_update BEFORE UPDATE ON tpl_delivery_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded deliveries are cancelled, never edited'); END;
CREATE TRIGGER tpl_delivery_invoices_no_update BEFORE UPDATE ON tpl_delivery_invoices BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded deliveries are cancelled, never edited'); END;
