-- Opening Fixed Asset (OBFA-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): an asset the shop owned before the cut-over
-- date, with the accumulated depreciation of the old books on that date. fa_assets holds purchases (a supplier and how
-- it was paid, checks an opening asset cannot meet) and the run lines and disposals point at it, so an opening asset
-- has its own insert-only tables, the same shape; the fa_all_* views read both kinds as one register.

-- The asset (OBFA-). The OBFA- document id is the asset's id and its party id on 15x0/15x1, as for an FA- purchase;
-- the document's date is the cut-over date. accumulated_cents is what the old books had on that date.
CREATE TABLE fa_opening_assets (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  class_code        TEXT NOT NULL REFERENCES fa_classes(code),
  description       TEXT NOT NULL,
  location          TEXT,
  acquired_on       TEXT NOT NULL CHECK (acquired_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  cost_cents        INTEGER NOT NULL CHECK (cost_cents > 0),
  residual_cents    INTEGER NOT NULL CHECK (residual_cents >= 0 AND residual_cents < cost_cents),
  life_months       INTEGER NOT NULL CHECK (life_months BETWEEN 1 AND 600),
  accumulated_cents INTEGER NOT NULL CHECK (accumulated_cents >= 0 AND accumulated_cents <= cost_cents - residual_cents)
) STRICT;
CREATE TRIGGER fa_opening_assets_no_update BEFORE UPDATE ON fa_opening_assets
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded opening asset is cancelled, never edited'); END;

-- A depreciation run's lines for opening assets: as fa_depreciation_lines, once per asset and month among recorded runs.
CREATE TABLE fa_opening_depreciation_lines (
  document_id       TEXT NOT NULL REFERENCES fa_depreciation_runs(document_id),
  asset_id          TEXT NOT NULL REFERENCES fa_opening_assets(document_id),
  month             TEXT NOT NULL,
  months_elapsed    INTEGER NOT NULL CHECK (months_elapsed > 0),
  charge_cents      INTEGER NOT NULL CHECK (charge_cents > 0),
  accumulated_cents INTEGER NOT NULL CHECK (accumulated_cents >= charge_cents), -- after this charge
  PRIMARY KEY (document_id, asset_id)
) STRICT;
CREATE INDEX fa_opening_depreciation_lines_asset ON fa_opening_depreciation_lines(asset_id, month);
CREATE TRIGGER fa_opening_depreciation_once BEFORE INSERT ON fa_opening_depreciation_lines
WHEN EXISTS (SELECT 1 FROM fa_opening_depreciation_lines l JOIN documents d ON d.id = l.document_id
             WHERE l.asset_id = NEW.asset_id AND l.month = NEW.month AND d.status = 'posted')
BEGIN SELECT RAISE(ABORT, 'DEPRECIATED_TWICE: this asset is already depreciated for that month'); END;
CREATE TRIGGER fa_opening_depreciation_lines_no_update BEFORE UPDATE ON fa_opening_depreciation_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded run is cancelled, never edited'); END;

-- A disposal (FAD-) of an opening asset: as fa_disposals.
CREATE TABLE fa_opening_disposals (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  asset_id          TEXT NOT NULL REFERENCES fa_opening_assets(document_id),
  kind              TEXT NOT NULL CHECK (kind IN ('retirement')),
  reason            TEXT NOT NULL,
  cost_cents        INTEGER NOT NULL CHECK (cost_cents > 0),
  accumulated_cents INTEGER NOT NULL CHECK (accumulated_cents >= 0 AND accumulated_cents <= cost_cents),
  proceeds_cents    INTEGER NOT NULL CHECK (proceeds_cents = 0),
  gain_cents        INTEGER NOT NULL CHECK (gain_cents >= 0),
  loss_cents        INTEGER NOT NULL CHECK (loss_cents >= 0),
  CHECK (proceeds_cents + accumulated_cents + loss_cents = cost_cents + gain_cents)
) STRICT;
CREATE INDEX fa_opening_disposals_asset ON fa_opening_disposals(asset_id);
CREATE TRIGGER fa_opening_disposals_no_update BEFORE UPDATE ON fa_opening_disposals
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded disposal is cancelled, never edited'); END;

-- Both kinds as one, for the register, the runs and the disposals to read. opening_accumulated_cents is NULL for a
-- purchase; for an opening asset it is the old books' figure on the cut-over date (its document's date).
CREATE VIEW fa_all_assets AS
  SELECT document_id, class_code, description, location, acquired_on, cost_cents, residual_cents, life_months,
         NULL AS opening_accumulated_cents
  FROM fa_assets
  UNION ALL
  SELECT document_id, class_code, description, location, acquired_on, cost_cents, residual_cents, life_months,
         accumulated_cents
  FROM fa_opening_assets;

CREATE VIEW fa_all_depreciation_lines AS
  SELECT document_id, asset_id, month, months_elapsed, charge_cents, accumulated_cents FROM fa_depreciation_lines
  UNION ALL
  SELECT document_id, asset_id, month, months_elapsed, charge_cents, accumulated_cents FROM fa_opening_depreciation_lines;

CREATE VIEW fa_all_disposals AS
  SELECT document_id, asset_id, kind, reason, cost_cents, accumulated_cents, proceeds_cents, gain_cents, loss_cents FROM fa_disposals
  UNION ALL
  SELECT document_id, asset_id, kind, reason, cost_cents, accumulated_cents, proceeds_cents, gain_cents, loss_cents FROM fa_opening_disposals;
