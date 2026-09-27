-- Deposit transfer (PLAN D5 DEP-XFER, D6 "transfer to a new/reissued JO", G-28): moves money held for a customer, a job
-- order's deposits (from_job_order_id) or their unapplied payments (NULL), to another job order of the same customer.
-- There, the JO's open receivable is settled first and the rest becomes its deposit, as a collection does (D3).
-- Amount: documents.total_cents = to_receivable_cents + to_deposit_cents.
CREATE TABLE col_deposit_transfers (
  document_id         TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id         TEXT NOT NULL,
  customer_name       TEXT NOT NULL, -- as it read when recorded
  from_job_order_id   TEXT REFERENCES documents(id),
  to_job_order_id     TEXT NOT NULL REFERENCES documents(id),
  to_receivable_cents INTEGER NOT NULL CHECK (to_receivable_cents >= 0),
  to_deposit_cents    INTEGER NOT NULL CHECK (to_deposit_cents >= 0),
  note                TEXT,
  CHECK (to_receivable_cents + to_deposit_cents > 0),
  CHECK (from_job_order_id IS NULL OR from_job_order_id <> to_job_order_id)
) STRICT;
CREATE INDEX col_deposit_transfers_customer ON col_deposit_transfers(customer_id);
CREATE INDEX col_deposit_transfers_to ON col_deposit_transfers(to_job_order_id);

CREATE TRIGGER col_deposit_transfers_no_update BEFORE UPDATE ON col_deposit_transfers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded deposit transfers are cancelled and reissued, never edited'); END;
