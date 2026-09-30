-- Customer checks (PLAN E5 tenders "check date and bank for checks -> 1103", E10 check deposits, ACC-23 post-dated checks).
-- Nothing here posts: money moves only through collections and fund transfers. These rows say which check is which, and
-- where it is (on hand, at the bank, back from the bank), read together with the documents' status.

-- A collection's tender into a checks place (Checks on hand, 1103) carries the check itself. Other tenders have no row.
CREATE TABLE col_tender_checks (
  document_id  TEXT NOT NULL,
  line_no      INTEGER NOT NULL,
  check_number TEXT NOT NULL,
  bank         TEXT NOT NULL,
  check_date   TEXT NOT NULL CHECK (check_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  PRIMARY KEY (document_id, line_no),
  FOREIGN KEY (document_id, line_no) REFERENCES col_tenders(document_id, line_no)
) STRICT;
CREATE INDEX col_tender_checks_number ON col_tender_checks(check_number);

-- Post-dated checks (ACC-23): a memo list, no journal. A check is recorded as a collection on its date, from this list.
CREATE TABLE col_pdcs (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL,
  customer_name TEXT NOT NULL, -- as it read when listed
  bank          TEXT NOT NULL,
  check_number  TEXT NOT NULL,
  check_date    TEXT NOT NULL CHECK (check_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  note          TEXT,
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX col_pdcs_customer ON col_pdcs(customer_id);

-- The job orders a post-dated check is for, in the order they are paid.
CREATE TABLE col_pdc_job_orders (
  pdc_id       TEXT NOT NULL REFERENCES col_pdcs(id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  job_order_id TEXT NOT NULL REFERENCES documents(id),
  PRIMARY KEY (pdc_id, line_no),
  UNIQUE (pdc_id, job_order_id)
) STRICT;

-- A post-dated check taken off the list (returned to the customer, replaced), with the reason.
CREATE TABLE col_pdc_voids (
  pdc_id    TEXT PRIMARY KEY REFERENCES col_pdcs(id),
  reason    TEXT NOT NULL,
  voided_at TEXT NOT NULL,
  voided_by TEXT NOT NULL REFERENCES users(id)
) STRICT;

-- The collection that recorded a post-dated check on its date. The check is used while that collection stands.
CREATE TABLE col_pdc_uses (
  document_id TEXT PRIMARY KEY REFERENCES col_collections(document_id),
  pdc_id      TEXT NOT NULL REFERENCES col_pdcs(id)
) STRICT;
CREATE INDEX col_pdc_uses_pdc ON col_pdc_uses(pdc_id);

-- Checks taken to the bank: the fund transfer (Checks on hand -> bank, PLAN E10) and each check it carried.
-- A check is at the bank while its deposits that stand outnumber its returns that stand.
CREATE TABLE col_check_deposits (
  transfer_id TEXT NOT NULL REFERENCES documents(id),
  document_id TEXT NOT NULL,
  line_no     INTEGER NOT NULL,
  PRIMARY KEY (transfer_id, document_id, line_no),
  FOREIGN KEY (document_id, line_no) REFERENCES col_tender_checks(document_id, line_no)
) STRICT;
CREATE INDEX col_check_deposits_check ON col_check_deposits(document_id, line_no);

-- A check the bank returned: the fund transfer that brought it back (bank -> Checks on hand), the deposit it came back
-- from, and the bank adjustment for the bank's charge, if any.
CREATE TABLE col_check_returns (
  transfer_id TEXT PRIMARY KEY REFERENCES documents(id),
  document_id TEXT NOT NULL,
  line_no     INTEGER NOT NULL,
  deposit_id  TEXT NOT NULL REFERENCES documents(id),
  charge_id   TEXT REFERENCES documents(id),
  reason      TEXT NOT NULL,
  FOREIGN KEY (document_id, line_no) REFERENCES col_tender_checks(document_id, line_no)
) STRICT;
CREATE INDEX col_check_returns_check ON col_check_returns(document_id, line_no);

CREATE TRIGGER col_tender_checks_no_update BEFORE UPDATE ON col_tender_checks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded collections are cancelled and reissued, never edited'); END;
CREATE TRIGGER col_pdcs_no_update BEFORE UPDATE ON col_pdcs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a post-dated check is voided and listed again, never edited'); END;
CREATE TRIGGER col_pdc_job_orders_no_update BEFORE UPDATE ON col_pdc_job_orders
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a post-dated check is voided and listed again, never edited'); END;
CREATE TRIGGER col_pdc_voids_no_update BEFORE UPDATE ON col_pdc_voids
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a void stands'); END;
CREATE TRIGGER col_pdc_uses_no_update BEFORE UPDATE ON col_pdc_uses
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded collections are cancelled and reissued, never edited'); END;
CREATE TRIGGER col_check_deposits_no_update BEFORE UPDATE ON col_check_deposits
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a deposit is undone by cancelling its fund transfer'); END;
CREATE TRIGGER col_check_returns_no_update BEFORE UPDATE ON col_check_returns
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a return is undone by cancelling its fund transfer'); END;
