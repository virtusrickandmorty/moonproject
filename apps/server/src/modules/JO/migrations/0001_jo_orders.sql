-- JO module tables (prefix jo_). A job order posts no journal (PLAN D5 JO-POST); its rows are insert-only.
-- customer_id, person_id, group_id and chart_id point at CUS records, which JO reads only through CUS.
CREATE TABLE jo_orders (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id       TEXT NOT NULL,
  customer_name     TEXT NOT NULL, -- as it read when recorded
  contact           TEXT,
  due_date          TEXT NOT NULL,
  priority          TEXT NOT NULL CHECK (priority IN ('normal','rush')),
  payment_terms     TEXT NOT NULL CHECK (payment_terms IN ('dp50','full','cod','net7','net15','net30')),
  required_dp_cents INTEGER NOT NULL CHECK (required_dp_cents >= 0),
  notes             TEXT
) STRICT;
CREATE INDEX jo_orders_customer ON jo_orders(customer_id);

CREATE TABLE jo_lines (
  document_id      TEXT NOT NULL REFERENCES jo_orders(document_id),
  line_no          INTEGER NOT NULL CHECK (line_no >= 1),
  kind             TEXT NOT NULL CHECK (kind IN ('made_to_order','service','ready_made')),
  description      TEXT NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  discount_cents   INTEGER NOT NULL CHECK (discount_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0 AND line_total_cents = qty * unit_price_cents - discount_cents),
  PRIMARY KEY (document_id, line_no)
) STRICT;

-- One row per wearer per line (PLAN E4). A measured row keeps the chart revision that was active when recorded.
CREATE TABLE jo_roster (
  document_id    TEXT NOT NULL,
  line_no        INTEGER NOT NULL,
  row_no         INTEGER NOT NULL CHECK (row_no >= 1),
  person_id      TEXT, -- NULL for a one-off name
  group_id       TEXT,
  wearer_name    TEXT NOT NULL,
  size_mode      TEXT NOT NULL CHECK (size_mode IN ('preset','measured')),
  size           TEXT,
  chart_id       TEXT,
  chart_revision INTEGER,
  jersey_name    TEXT,
  jersey_number  TEXT,
  qty            INTEGER NOT NULL CHECK (qty > 0),
  notes          TEXT,
  PRIMARY KEY (document_id, line_no, row_no),
  FOREIGN KEY (document_id, line_no) REFERENCES jo_lines(document_id, line_no),
  CHECK (size_mode = 'measured' OR size IS NOT NULL),
  CHECK (size_mode = 'preset' OR (person_id IS NOT NULL AND chart_id IS NOT NULL AND chart_revision IS NOT NULL))
) STRICT;

-- Stage changes (PLAN E4). The current stage is the latest row, or 'open' when there is none.
CREATE TABLE jo_stage_events (
  document_id TEXT NOT NULL REFERENCES jo_orders(document_id),
  seq         INTEGER NOT NULL CHECK (seq >= 1),
  from_stage  TEXT NOT NULL,
  to_stage    TEXT NOT NULL CHECK (to_stage IN ('open','in_production','ready','partially_released','released','closed')),
  reason      TEXT,
  at          TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (document_id, seq)
) STRICT;
CREATE TRIGGER jo_stage_events_follow_on BEFORE INSERT ON jo_stage_events
WHEN NEW.seq <> COALESCE((SELECT MAX(seq) FROM jo_stage_events WHERE document_id = NEW.document_id), 0) + 1
  OR NEW.from_stage IS NOT COALESCE((SELECT to_stage FROM jo_stage_events WHERE document_id = NEW.document_id ORDER BY seq DESC LIMIT 1), 'open')
BEGIN SELECT RAISE(ABORT, 'JO_STAGE: a stage change must follow on from the current stage'); END;

CREATE TRIGGER jo_orders_no_update BEFORE UPDATE ON jo_orders
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded job orders are cancelled and reissued, never edited'); END;
CREATE TRIGGER jo_lines_no_update BEFORE UPDATE ON jo_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded job orders are cancelled and reissued, never edited'); END;
CREATE TRIGGER jo_roster_no_update BEFORE UPDATE ON jo_roster
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded job orders are cancelled and reissued, never edited'); END;
CREATE TRIGGER jo_stage_events_no_update BEFORE UPDATE ON jo_stage_events
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: stage history is append-only'); END;
