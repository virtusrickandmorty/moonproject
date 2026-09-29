-- Sale of a fixed asset (FAD-, PLAN D5 FA-DISP with INV-REC): the disposal is written on a manual invoice from the
-- booklet, paid in full on the spot into a cash place. fa_disposals and fa_opening_disposals take retirements only
-- (their checks allow nothing received), so a sale of either kind of asset has its own insert-only table here, and
-- fa_all_disposals reads it too, so the register, the runs and the asset pages see a sold asset as disposed of.
-- Figures as at the sale; proceeds for the gain or loss are the NET of the invoice (gross less output VAT).
CREATE TABLE fa_asset_sales (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  asset_id          TEXT NOT NULL, -- an FA- purchase or an OBFA- opening asset (fa_all_assets)
  reason            TEXT NOT NULL,
  cost_cents        INTEGER NOT NULL CHECK (cost_cents > 0),
  accumulated_cents INTEGER NOT NULL CHECK (accumulated_cents >= 0 AND accumulated_cents <= cost_cents),
  gross_cents       INTEGER NOT NULL CHECK (gross_cents > 0), -- the invoice total, VAT included
  vat_rate_bp       INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  vat_cents         INTEGER NOT NULL CHECK (vat_cents >= 0),
  net_cents         INTEGER NOT NULL CHECK (net_cents > 0), -- VATable sales on the booklet
  gain_cents        INTEGER NOT NULL CHECK (gain_cents >= 0),
  loss_cents        INTEGER NOT NULL CHECK (loss_cents >= 0),
  cash_account_id   INTEGER NOT NULL REFERENCES accounts(id),
  invoice_number    TEXT NOT NULL, -- manual BIR invoice number as typed; used once, ever, with JO and QS invoice records
  customer_id       TEXT, -- a customer picked, or NULL when the buyer was typed
  buyer_name        TEXT NOT NULL, -- as it read when recorded
  buyer_address     TEXT,
  buyer_tin         TEXT,
  CHECK (net_cents + vat_cents = gross_cents),
  CHECK (net_cents + accumulated_cents + loss_cents = cost_cents + gain_cents),
  CHECK (gain_cents = 0 OR loss_cents = 0)
) STRICT;
-- A cancelled sale keeps its number ("cancelled, all copies kept", D6), and "0502" and "502" are the same paper.
CREATE UNIQUE INDEX fa_asset_sales_invoice ON fa_asset_sales(CAST(invoice_number AS INTEGER));
CREATE INDEX fa_asset_sales_asset ON fa_asset_sales(asset_id);
CREATE TRIGGER fa_asset_sales_no_update BEFORE UPDATE ON fa_asset_sales
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded disposal is cancelled, never edited'); END;

-- Retirements and sales as one: a sale's proceeds are its NET, so proceeds + accumulated + loss = cost + gain holds for all.
DROP VIEW fa_all_disposals;
CREATE VIEW fa_all_disposals AS
  SELECT document_id, asset_id, kind, reason, cost_cents, accumulated_cents, proceeds_cents, gain_cents, loss_cents FROM fa_disposals
  UNION ALL
  SELECT document_id, asset_id, kind, reason, cost_cents, accumulated_cents, proceeds_cents, gain_cents, loss_cents FROM fa_opening_disposals
  UNION ALL
  SELECT document_id, asset_id, 'sale', reason, cost_cents, accumulated_cents, net_cents, gain_cents, loss_cents FROM fa_asset_sales;
