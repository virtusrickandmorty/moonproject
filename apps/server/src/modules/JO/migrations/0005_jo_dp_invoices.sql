-- Downpayment invoice (PLAN D5 INV-DP, D3 "Downpayment VAT modes" mode C, ACC-02): in mode C a downpayment is invoiced
-- when it is received, on a manual BIR invoice of the same booklet as the release invoices (IR- series, D7).
--   Dr 1201 AR (gross) / Cr 2201 customer deposits (NET_dp) ; Cr 2301 output VAT (VAT_dp)
--   Dr 2201 / Cr 1201: money already held for the job order is applied to it, like DEP-APPLY
-- The release invoice then takes NET_dp out of 2201 into sales (invoice-record.ts). The downpayment amounts it invoices
-- and releases are kept in col_deposit_vat (COL), with those of mode B.
CREATE TABLE jo_dp_invoices (
  document_id           TEXT PRIMARY KEY REFERENCES documents(id),
  job_order_id          TEXT NOT NULL REFERENCES jo_orders(document_id),
  customer_id           TEXT NOT NULL,
  customer_name         TEXT NOT NULL, -- as it read when recorded
  invoice_number        TEXT NOT NULL, -- manual BIR invoice number as typed; used once, ever, across all invoice records
  vat_rate_bp           INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  gross_cents           INTEGER NOT NULL CHECK (gross_cents > 0),
  vat_cents             INTEGER NOT NULL CHECK (vat_cents >= 0 AND vat_cents <= gross_cents),
  deposit_applied_cents INTEGER NOT NULL CHECK (deposit_applied_cents BETWEEN 0 AND gross_cents),
  note                  TEXT
) STRICT;
CREATE UNIQUE INDEX jo_dp_invoices_number ON jo_dp_invoices(CAST(invoice_number AS INTEGER));
CREATE INDEX jo_dp_invoices_jo ON jo_dp_invoices(job_order_id);

CREATE TRIGGER jo_dp_invoices_no_update BEFORE UPDATE ON jo_dp_invoices
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded invoice records are cancelled and reissued, never edited'); END;
