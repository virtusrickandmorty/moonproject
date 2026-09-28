-- FA module tables (prefix fa_). Document rows are insert-only; balances come from the ledger (NR-2).

-- Asset classes and default lives (PLAN D2, E10, ACC-16), accounts by role key. Production class depreciates to 5302,
-- the others to 6210. A NULL life (leasehold) is typed on each asset: the lease term.
CREATE TABLE fa_classes (
  code                TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  cost_role           TEXT NOT NULL,
  accum_role          TEXT NOT NULL,
  expense_role        TEXT NOT NULL CHECK (expense_role IN ('DEPR_PRODUCTION', 'DEPR_OFFICE')),
  default_life_months INTEGER CHECK (default_life_months IS NULL OR default_life_months > 0),
  sort_order          INTEGER NOT NULL
) STRICT;
INSERT INTO fa_classes (code, name, cost_role, accum_role, expense_role, default_life_months, sort_order) VALUES
('machinery', 'Machinery and production equipment', 'FA_MACHINERY', 'FA_MACHINERY_ACCUM', 'DEPR_PRODUCTION', 60, 1),
('computers', 'Office and computer equipment', 'FA_OFFICE', 'FA_OFFICE_ACCUM', 'DEPR_OFFICE', 36, 2),
('furniture', 'Furniture and fixtures', 'FA_FURNITURE', 'FA_FURNITURE_ACCUM', 'DEPR_OFFICE', 60, 3),
('vehicles', 'Transportation equipment', 'FA_VEHICLES', 'FA_VEHICLES_ACCUM', 'DEPR_OFFICE', 60, 4),
('leasehold', 'Leasehold improvements', 'FA_LEASEHOLD', 'FA_LEASEHOLD_ACCUM', 'DEPR_OFFICE', NULL, 5);

-- The asset register (FA-BUY). The FA- document id is the asset's id and its party id on 15x0/15x1 (and on 2602 for
-- the financed part, until LOAN keeps a loan register). Status is worked out from the documents, never stored.
CREATE TABLE fa_assets (
  document_id           TEXT PRIMARY KEY REFERENCES documents(id),
  class_code            TEXT NOT NULL REFERENCES fa_classes(code),
  description           TEXT NOT NULL,
  location              TEXT,
  acquired_on           TEXT NOT NULL,
  cost_cents            INTEGER NOT NULL CHECK (cost_cents > 0),
  residual_cents        INTEGER NOT NULL CHECK (residual_cents >= 0 AND residual_cents < cost_cents),
  life_months           INTEGER NOT NULL CHECK (life_months BETWEEN 1 AND 600),
  supplier_id           TEXT NOT NULL, -- a PUR supplier
  supplier_invoice_no   TEXT,
  supplier_invoice_date TEXT,
  gross_cents           INTEGER NOT NULL CHECK (gross_cents > 0),
  vat_rate_bp           INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  input_vat_cents       INTEGER NOT NULL CHECK (input_vat_cents >= 0),
  cash_account_id       INTEGER REFERENCES accounts(id),
  paid_cents            INTEGER NOT NULL CHECK (paid_cents >= 0),
  on_account_cents      INTEGER NOT NULL CHECK (on_account_cents >= 0),
  financed_cents        INTEGER NOT NULL CHECK (financed_cents >= 0),
  lender                TEXT,
  CHECK (cost_cents + input_vat_cents = gross_cents),
  CHECK (paid_cents + on_account_cents + financed_cents = gross_cents),
  CHECK ((cash_account_id IS NULL) = (paid_cents = 0)),
  CHECK ((lender IS NULL) = (financed_cents = 0))
) STRICT;
CREATE TRIGGER fa_assets_no_update BEFORE UPDATE ON fa_assets
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded asset purchase is cancelled, never edited'); END;

-- Depreciation run (DEPR-): one line per asset charged, once per asset and month among recorded runs (G-21).
CREATE TABLE fa_depreciation_runs (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]')
) STRICT;
CREATE INDEX fa_depreciation_runs_month ON fa_depreciation_runs(month);
CREATE TABLE fa_depreciation_lines (
  document_id       TEXT NOT NULL REFERENCES fa_depreciation_runs(document_id),
  asset_id          TEXT NOT NULL REFERENCES fa_assets(document_id),
  month             TEXT NOT NULL,
  months_elapsed    INTEGER NOT NULL CHECK (months_elapsed > 0),
  charge_cents      INTEGER NOT NULL CHECK (charge_cents > 0),
  accumulated_cents INTEGER NOT NULL CHECK (accumulated_cents >= charge_cents), -- after this charge
  PRIMARY KEY (document_id, asset_id)
) STRICT;
CREATE INDEX fa_depreciation_lines_asset ON fa_depreciation_lines(asset_id, month);
CREATE TRIGGER fa_depreciation_once BEFORE INSERT ON fa_depreciation_lines
WHEN EXISTS (SELECT 1 FROM fa_depreciation_lines l JOIN documents d ON d.id = l.document_id
             WHERE l.asset_id = NEW.asset_id AND l.month = NEW.month AND d.status = 'posted')
BEGIN SELECT RAISE(ABORT, 'DEPRECIATED_TWICE: this asset is already depreciated for that month'); END;
CREATE TRIGGER fa_depreciation_runs_no_update BEFORE UPDATE ON fa_depreciation_runs BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded run is cancelled, never edited'); END;
CREATE TRIGGER fa_depreciation_lines_no_update BEFORE UPDATE ON fa_depreciation_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded run is cancelled, never edited'); END;

-- Disposal (FAD-): retirement for now; a sale needs an invoice record (D5 FA-DISP). Figures as at the disposal.
CREATE TABLE fa_disposals (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  asset_id          TEXT NOT NULL REFERENCES fa_assets(document_id),
  kind              TEXT NOT NULL CHECK (kind IN ('retirement')),
  reason            TEXT NOT NULL,
  cost_cents        INTEGER NOT NULL CHECK (cost_cents > 0),
  accumulated_cents INTEGER NOT NULL CHECK (accumulated_cents >= 0 AND accumulated_cents <= cost_cents),
  proceeds_cents    INTEGER NOT NULL CHECK (proceeds_cents = 0),
  gain_cents        INTEGER NOT NULL CHECK (gain_cents >= 0),
  loss_cents        INTEGER NOT NULL CHECK (loss_cents >= 0),
  CHECK (proceeds_cents + accumulated_cents + loss_cents = cost_cents + gain_cents)
) STRICT;
CREATE INDEX fa_disposals_asset ON fa_disposals(asset_id);
CREATE TRIGGER fa_disposals_no_update BEFORE UPDATE ON fa_disposals
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded disposal is cancelled, never edited'); END;
