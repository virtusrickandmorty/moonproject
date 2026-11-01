-- Costing & estimates (the owner's request, Nov 2026): a cost sheet per price list item, and the shop's costing rules.
-- Insert-only: a change is a new version, so the history is kept and an estimate can say which version it used.

-- The costing rules: overhead (a percent of the direct cost), commission (a percent of the selling price), what prices
-- round up to, and the margin wanted from each quantity up. The latest version is in force.
CREATE TABLE est_rules (
  id             INTEGER PRIMARY KEY,
  overhead_bp    INTEGER NOT NULL CHECK (overhead_bp BETWEEN 0 AND 10000),
  commission_bp  INTEGER NOT NULL CHECK (commission_bp BETWEEN 0 AND 5000),
  round_to_cents INTEGER NOT NULL CHECK (round_to_cents IN (1, 100, 500, 1000)),
  reason         TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES users(id) -- NULL for the starter row below
) STRICT;
CREATE TABLE est_rule_tiers (
  rule_id   INTEGER NOT NULL REFERENCES est_rules(id),
  from_qty  INTEGER NOT NULL CHECK (from_qty BETWEEN 1 AND 100000),
  margin_bp INTEGER NOT NULL CHECK (margin_bp BETWEEN 0 AND 9000),
  PRIMARY KEY (rule_id, from_qty)
) STRICT;

-- One cost sheet per price list item; its versions hold the figures.
CREATE TABLE est_sheets (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE TABLE est_sheet_versions (
  id           INTEGER PRIMARY KEY,
  sheet_id     TEXT NOT NULL REFERENCES est_sheets(id),
  garment_type TEXT NOT NULL COLLATE NOCASE,       -- for the labour, from the piece-rate table
  complexity   TEXT NOT NULL CHECK (complexity IN ('simple','standard','complex')),
  is_set       INTEGER NOT NULL CHECK (is_set IN (0, 1)), -- a set's labour is its upper and lower parts
  setup_cents  INTEGER NOT NULL CHECK (setup_cents BETWEEN 0 AND 100000000), -- once per order (layout, sample)
  reason       TEXT NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX est_sheet_versions_sheet ON est_sheet_versions(sheet_id, id);
-- What a piece takes: a supply from Purchasing (at its latest purchase cost) or a typed cost per piece.
-- saved_cost_cents: the unit cost when the version was saved, to tell when a supply's cost has moved since.
CREATE TABLE est_sheet_lines (
  version_id       INTEGER NOT NULL REFERENCES est_sheet_versions(id),
  line_no          INTEGER NOT NULL CHECK (line_no >= 1),
  kind             TEXT NOT NULL CHECK (kind IN ('materials','sublimation')),
  supply_id        TEXT,
  description      TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  qty_milli        INTEGER NOT NULL CHECK (qty_milli BETWEEN 1 AND 100000000), -- per piece, × 1000 (1.25 yd = 1250)
  typed_cost_cents INTEGER CHECK (typed_cost_cents IS NULL OR typed_cost_cents BETWEEN 0 AND 100000000),
  saved_cost_cents INTEGER NOT NULL CHECK (saved_cost_cents >= 0),
  CHECK ((supply_id IS NULL) = (typed_cost_cents IS NOT NULL)),
  PRIMARY KEY (version_id, line_no)
) STRICT;

CREATE TRIGGER est_rules_no_update BEFORE UPDATE ON est_rules BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: new rules are a new version'); END;
CREATE TRIGGER est_rule_tiers_no_update BEFORE UPDATE ON est_rule_tiers BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: new rules are a new version'); END;
CREATE TRIGGER est_sheets_no_update BEFORE UPDATE ON est_sheets BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a cost sheet changes by a new version'); END;
CREATE TRIGGER est_sheet_versions_no_update BEFORE UPDATE ON est_sheet_versions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a cost sheet changes by a new version'); END;
CREATE TRIGGER est_sheet_lines_no_update BEFORE UPDATE ON est_sheet_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a cost sheet changes by a new version'); END;

-- Starter rules, MADE UP, to be set by the owner: 10% overhead, no commission, prices to the next ₱5, and 45% margin
-- from 1 piece, 35% from 12, 25% from 50.
INSERT INTO est_rules (id, overhead_bp, commission_bp, round_to_cents, reason, created_at) VALUES
  (1, 1000, 0, 500, 'Starter rules (made up), to be set by the owner', '2026-11-01T00:00:00.000+08:00');
INSERT INTO est_rule_tiers (rule_id, from_qty, margin_bp) VALUES (1, 1, 4500), (1, 12, 3500), (1, 50, 2500);
