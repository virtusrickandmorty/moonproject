-- Cost estimates (the owner's request, Nov 2026): a document (EST-000001) that prices an order from the cost sheets and
-- keeps what it took, so the figures stay as they were when it was recorded. No journal: it is not money.
CREATE TABLE est_estimates (
  document_id   TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id   TEXT,
  customer_name TEXT NOT NULL,
  prospect_name TEXT,
  contact       TEXT,
  notes         TEXT,
  rules_id      INTEGER NOT NULL REFERENCES est_rules(id),
  commission_bp INTEGER NOT NULL CHECK (commission_bp BETWEEN 0 AND 5000),
  CHECK ((customer_id IS NULL) <> (prospect_name IS NULL))
) STRICT;
CREATE TRIGGER est_estimates_no_update BEFORE UPDATE ON est_estimates
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: cancel and reissue an estimate'); END;

-- One line per item: the cost of a piece then (the sheet version, the setup over this quantity, any extra), the margin
-- of its tier, the suggested price and the price asked (with a reason when it differs).
CREATE TABLE est_estimate_lines (
  document_id      TEXT NOT NULL REFERENCES est_estimates(document_id),
  line_no          INTEGER NOT NULL CHECK (line_no > 0),
  item_id          TEXT NOT NULL,
  description      TEXT NOT NULL,
  unit             TEXT NOT NULL CHECK (unit IN ('pc', 'set')),
  qty              INTEGER NOT NULL CHECK (qty > 0),
  sheet_version_id INTEGER NOT NULL REFERENCES est_sheet_versions(id),
  tier_from_qty    INTEGER NOT NULL CHECK (tier_from_qty >= 1),
  margin_bp        INTEGER NOT NULL CHECK (margin_bp BETWEEN 0 AND 9000),
  extra_cost_cents INTEGER NOT NULL CHECK (extra_cost_cents >= 0),
  extra_reason     TEXT,
  unit_cost_cents  INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  suggested_cents  INTEGER NOT NULL CHECK (suggested_cents >= 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  price_reason     TEXT,
  commission_cents INTEGER NOT NULL CHECK (commission_cents >= 0),
  catalog_cents    INTEGER,
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents = qty * unit_price_cents),
  CHECK ((extra_cost_cents = 0) = (extra_reason IS NULL)),
  CHECK ((unit_price_cents = suggested_cents) = (price_reason IS NULL)),
  PRIMARY KEY (document_id, line_no)
) STRICT;
CREATE TRIGGER est_estimate_lines_no_update BEFORE UPDATE ON est_estimate_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: cancel and reissue an estimate'); END;
