-- Selling a fixed asset (FAD-, PLAN D5 FA-DISP, INV-REC, D7): a disposal may now be a sale, recorded from the manual
-- BIR invoice written for it. SQLite cannot change a CHECK, so fa_disposals and fa_opening_disposals are recreated to take
-- kind 'sale' with its proceeds (the NET of the price; the VAT goes to 2301). Rows and figures are copied as they are.
-- The view over both is dropped first and made again, the same columns.
DROP VIEW fa_all_disposals;

CREATE TABLE fa_disposals_new (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  asset_id          TEXT NOT NULL REFERENCES fa_assets(document_id),
  kind              TEXT NOT NULL CHECK (kind IN ('retirement', 'sale')),
  reason            TEXT NOT NULL,
  cost_cents        INTEGER NOT NULL CHECK (cost_cents > 0),
  accumulated_cents INTEGER NOT NULL CHECK (accumulated_cents >= 0 AND accumulated_cents <= cost_cents),
  proceeds_cents    INTEGER NOT NULL CHECK (proceeds_cents >= 0), -- a sale: the price less its VAT (NET); a retirement: 0
  gain_cents        INTEGER NOT NULL CHECK (gain_cents >= 0),
  loss_cents        INTEGER NOT NULL CHECK (loss_cents >= 0),
  CHECK ((kind = 'sale') = (proceeds_cents > 0)),
  CHECK (gain_cents = 0 OR loss_cents = 0),
  CHECK (proceeds_cents + accumulated_cents + loss_cents = cost_cents + gain_cents)
) STRICT;
INSERT INTO fa_disposals_new SELECT document_id, asset_id, kind, reason, cost_cents, accumulated_cents, proceeds_cents, gain_cents, loss_cents FROM fa_disposals;
DROP TABLE fa_disposals;
ALTER TABLE fa_disposals_new RENAME TO fa_disposals;
CREATE INDEX fa_disposals_asset ON fa_disposals(asset_id);
CREATE TRIGGER fa_disposals_no_update BEFORE UPDATE ON fa_disposals
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded disposal is cancelled, never edited'); END;

CREATE TABLE fa_opening_disposals_new (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  asset_id          TEXT NOT NULL REFERENCES fa_opening_assets(document_id),
  kind              TEXT NOT NULL CHECK (kind IN ('retirement', 'sale')),
  reason            TEXT NOT NULL,
  cost_cents        INTEGER NOT NULL CHECK (cost_cents > 0),
  accumulated_cents INTEGER NOT NULL CHECK (accumulated_cents >= 0 AND accumulated_cents <= cost_cents),
  proceeds_cents    INTEGER NOT NULL CHECK (proceeds_cents >= 0),
  gain_cents        INTEGER NOT NULL CHECK (gain_cents >= 0),
  loss_cents        INTEGER NOT NULL CHECK (loss_cents >= 0),
  CHECK ((kind = 'sale') = (proceeds_cents > 0)),
  CHECK (gain_cents = 0 OR loss_cents = 0),
  CHECK (proceeds_cents + accumulated_cents + loss_cents = cost_cents + gain_cents)
) STRICT;
INSERT INTO fa_opening_disposals_new SELECT document_id, asset_id, kind, reason, cost_cents, accumulated_cents, proceeds_cents, gain_cents, loss_cents FROM fa_opening_disposals;
DROP TABLE fa_opening_disposals;
ALTER TABLE fa_opening_disposals_new RENAME TO fa_opening_disposals;
CREATE INDEX fa_opening_disposals_asset ON fa_opening_disposals(asset_id);
CREATE TRIGGER fa_opening_disposals_no_update BEFORE UPDATE ON fa_opening_disposals
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded disposal is cancelled, never edited'); END;

CREATE VIEW fa_all_disposals AS
  SELECT document_id, asset_id, kind, reason, cost_cents, accumulated_cents, proceeds_cents, gain_cents, loss_cents FROM fa_disposals
  UNION ALL
  SELECT document_id, asset_id, kind, reason, cost_cents, accumulated_cents, proceeds_cents, gain_cents, loss_cents FROM fa_opening_disposals;

-- The invoice of a sale (one row per sale disposal, a bought or an opening asset alike). The buyer is a customer picked
-- (customer_id) or a name, address and TIN typed; buyer_name is as it read when recorded. The booklet number is used
-- once, ever, across the IR- series (JO invoice records, downpayment invoices, quick sales and these): a cancelled sale
-- keeps its number ("cancelled, all copies kept", D6). Paid in full into one cash place (a bank transfer counts).
CREATE TABLE fa_sales (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id     TEXT, -- a CUS customer, or NULL for a buyer typed on the sale
  buyer_name      TEXT NOT NULL,
  buyer_address   TEXT,
  buyer_tin       TEXT,
  invoice_number  TEXT NOT NULL, -- manual BIR invoice number as typed
  vat_rate_bp     INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  gross_cents     INTEGER NOT NULL CHECK (gross_cents > 0), -- the price, VAT included
  vat_cents       INTEGER NOT NULL CHECK (vat_cents >= 0),
  net_cents       INTEGER NOT NULL CHECK (net_cents > 0),
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  CHECK (net_cents + vat_cents = gross_cents),
  CHECK (customer_id IS NOT NULL OR (buyer_address IS NOT NULL AND buyer_tin IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX fa_sales_invoice ON fa_sales(CAST(invoice_number AS INTEGER));
CREATE TRIGGER fa_sales_no_update BEFORE UPDATE ON fa_sales
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded sale is cancelled, never edited'); END;
