-- Downpayment VAT modes (PLAN D3 "Downpayment VAT modes", D5 DEP-VAT, DEP-VAT-REV, INV-DP; ACC-02). One row for each job
-- order whose deposits a document moves: a collection or deposit transfer that puts a deposit on it (every mode: the
-- first one fixes the job order's mode), and any document that moves output VAT recognised on its deposits (2209, mode B)
-- or downpayments invoiced on it (mode C). JO's invoice records write their rows through COL public.ts.
--   posting 'original': the document's own journal (a cancelled document's rows count for nothing, like its journal and
--   its mirror); 'cancel': the follow-up journal of its cancel (D6), which stands.
-- Amounts are signed: + into the job order, − out of it.
CREATE TABLE col_deposit_vat (
  document_id         TEXT NOT NULL REFERENCES documents(id),
  posting             TEXT NOT NULL CHECK (posting IN ('original', 'cancel')),
  line_no             INTEGER NOT NULL CHECK (line_no >= 1),
  job_order_id        TEXT NOT NULL REFERENCES documents(id),
  customer_id         TEXT NOT NULL,
  mode                TEXT NOT NULL CHECK (mode IN ('A', 'B', 'C')),
  deposit_cents       INTEGER NOT NULL, -- money into or out of the job order's deposits (2201)
  deposit_vat_cents   INTEGER NOT NULL, -- 2209 output VAT recognised on those deposits: + Dr 2209, − Cr 2209 (mode B)
  deposit_base_cents  INTEGER NOT NULL, -- the VATable amount of deposit_vat_cents, same sign
  dp_invoiced_cents   INTEGER NOT NULL, -- mode C: + invoiced on a downpayment invoice (gross), − taken into sales on release
  dp_vat_cents        INTEGER NOT NULL, -- the output VAT in dp_invoiced_cents
  register_base_cents INTEGER NOT NULL, -- what this adds to the VATable sales of its journal in the sales register (TAX)
  PRIMARY KEY (document_id, posting, line_no)
) STRICT;
CREATE INDEX col_deposit_vat_jo ON col_deposit_vat(job_order_id);

CREATE TRIGGER col_deposit_vat_no_update BEFORE UPDATE ON col_deposit_vat
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded deposit VAT rows are never edited; a cancel mirrors them'); END;
