-- Opening job order (OBJO-, PLAN D8 "Cut-over" step 2, MIG-02 part 2): a job order taken before the cut-over date and
-- not finished or not paid for. Its header, lines and roster go into jo_orders, jo_lines and jo_roster like any job
-- order's, so production, releases, invoice records and collections work on it; this table keeps what came from the
-- old records. Insert-only.
CREATE TABLE jo_opening_orders (
  document_id      TEXT PRIMARY KEY REFERENCES jo_orders(document_id),
  old_number       TEXT NOT NULL, -- the job order number in the old records
  deposits_cents   INTEGER NOT NULL CHECK (deposits_cents >= 0), -- paid on it and not yet applied: Dr 3900 / Cr 2201
  deposits_memo    TEXT, -- the old receipt numbers
  receivable_cents INTEGER NOT NULL CHECK (receivable_cents >= 0), -- released and invoiced, not yet paid: Dr 1201 / Cr 3900
  old_invoices     TEXT, -- the old invoice numbers of the receivable
  CHECK (receivable_cents = 0 OR old_invoices IS NOT NULL)
) STRICT;
CREATE INDEX jo_opening_orders_old_number ON jo_opening_orders(old_number);

CREATE TRIGGER jo_opening_orders_no_update BEFORE UPDATE ON jo_opening_orders
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded opening job orders are cancelled and reissued, never edited'); END;
