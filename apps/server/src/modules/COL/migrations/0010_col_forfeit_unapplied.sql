-- A deposit forfeit without a job order (the owner's request, 26 Oct 2026): money a customer paid before any job order
-- (a layout fee deposit and other deposits, kept as their credit) is credited to a job order if they order, or kept as
-- other income once it is 30 days old and they did not. Such a forfeit names the customer only: job_order_id may be
-- NULL. Nothing points to col_forfeits, so it is recreated (SQLite cannot drop a NOT NULL), keeping every row.
CREATE TABLE col_forfeits_next (
  document_id      TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id      TEXT NOT NULL,
  customer_name    TEXT NOT NULL,
  job_order_id     TEXT REFERENCES documents(id), -- NULL: the customer's deposits not on a job order
  vatable          INTEGER NOT NULL CHECK (vatable IN (0,1)),
  vat_rate_bp      INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  vat_cents        INTEGER NOT NULL CHECK (vat_cents >= 0 AND (vatable = 1 OR vat_cents = 0)),
  marked_abandoned INTEGER NOT NULL CHECK (marked_abandoned IN (0,1) AND (job_order_id IS NOT NULL OR marked_abandoned = 0)),
  reason           TEXT NOT NULL
) STRICT;
INSERT INTO col_forfeits_next (document_id, customer_id, customer_name, job_order_id, vatable, vat_rate_bp, vat_cents, marked_abandoned, reason)
  SELECT document_id, customer_id, customer_name, job_order_id, vatable, vat_rate_bp, vat_cents, marked_abandoned, reason FROM col_forfeits;
DROP TABLE col_forfeits;
ALTER TABLE col_forfeits_next RENAME TO col_forfeits;
CREATE INDEX col_forfeits_jo ON col_forfeits(job_order_id);
CREATE INDEX col_forfeits_customer ON col_forfeits(customer_id);
CREATE TRIGGER col_forfeits_no_update BEFORE UPDATE ON col_forfeits
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded forfeits are cancelled and reissued, never edited'); END;
