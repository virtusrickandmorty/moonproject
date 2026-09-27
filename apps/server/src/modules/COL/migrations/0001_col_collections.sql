-- COL module tables (prefix col_). Posted rows are insert-only: a mistake is cancelled (mirror journal) and reissued.
-- customer_id points at CUS and job_order_id at a JO document; COL reads both only through their public.ts.

-- Collection (PLAN E5, D5 DEP-RCV / COL-RCV / COL-OVER). Totals: documents.total_cents = Σ tenders + CWT.
CREATE TABLE col_collections (
  document_id      TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id      TEXT NOT NULL,
  customer_name    TEXT NOT NULL, -- as it read when recorded
  cr_number        TEXT NOT NULL, -- ATP booklet CR number as typed; used once, ever (unique index below)
  cwt_cents        INTEGER NOT NULL CHECK (cwt_cents >= 0),
  cwt_atc          TEXT CHECK (cwt_atc IN ('WC158','WC160','other')),
  cert_2307        TEXT CHECK (cert_2307 IN ('pending','received')), -- as recorded; later status belongs to the TAX 2307 register
  unapplied_cents  INTEGER NOT NULL CHECK (unapplied_cents >= 0),
  short_over_cents INTEGER NOT NULL CHECK (short_over_cents BETWEEN -100 AND 100), -- + over kept, - short absorbed (D4.9)
  settle_small_difference INTEGER NOT NULL CHECK (settle_small_difference IN (0,1)),
  note             TEXT,
  CHECK ((cwt_cents = 0) = (cwt_atc IS NULL) AND (cwt_cents = 0) = (cert_2307 IS NULL)),
  CHECK (unapplied_cents = 0 OR short_over_cents = 0)
) STRICT;
CREATE INDEX col_collections_customer ON col_collections(customer_id);
-- A cancelled CR keeps its number (D6), and "0123" and "123" are the same paper receipt.
CREATE UNIQUE INDEX col_collections_cr ON col_collections(CAST(cr_number AS INTEGER));

-- One row per tender: where the money went (a cash place is its own GL account).
CREATE TABLE col_tenders (
  document_id  TEXT NOT NULL REFERENCES col_collections(document_id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference    TEXT, -- GCash or bank reference, or check number and bank
  PRIMARY KEY (document_id, line_no)
) STRICT;

-- One row per job order paid: the open receivable is settled first, the rest is a deposit on the JO (D3).
CREATE TABLE col_applications (
  document_id         TEXT NOT NULL REFERENCES col_collections(document_id),
  line_no             INTEGER NOT NULL CHECK (line_no >= 1),
  job_order_id        TEXT NOT NULL REFERENCES documents(id),
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  to_receivable_cents INTEGER NOT NULL CHECK (to_receivable_cents >= 0),
  to_deposit_cents    INTEGER NOT NULL CHECK (to_deposit_cents >= 0),
  PRIMARY KEY (document_id, line_no),
  UNIQUE (document_id, job_order_id),
  CHECK (amount_cents = to_receivable_cents + to_deposit_cents)
) STRICT;
CREATE INDEX col_applications_jo ON col_applications(job_order_id);

-- Customer refund (D5 DEP-REFUND): deposits of one JO, or unapplied payments when job_order_id is NULL.
CREATE TABLE col_refunds (
  document_id   TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id   TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  job_order_id  TEXT REFERENCES documents(id),
  reason        TEXT NOT NULL
) STRICT;
CREATE INDEX col_refunds_customer ON col_refunds(customer_id);

CREATE TABLE col_refund_tenders (
  document_id  TEXT NOT NULL REFERENCES col_refunds(document_id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference    TEXT,
  PRIMARY KEY (document_id, line_no)
) STRICT;

CREATE TRIGGER col_collections_no_update BEFORE UPDATE ON col_collections
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded collections are cancelled and reissued, never edited'); END;
CREATE TRIGGER col_tenders_no_update BEFORE UPDATE ON col_tenders
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded collections are cancelled and reissued, never edited'); END;
CREATE TRIGGER col_applications_no_update BEFORE UPDATE ON col_applications
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded collections are cancelled and reissued, never edited'); END;
CREATE TRIGGER col_refunds_no_update BEFORE UPDATE ON col_refunds
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded refunds are cancelled and reissued, never edited'); END;
CREATE TRIGGER col_refund_tenders_no_update BEFORE UPDATE ON col_refund_tenders
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded refunds are cancelled and reissued, never edited'); END;
