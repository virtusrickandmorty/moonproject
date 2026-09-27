-- Release (REL-, PLAN E4) and invoice record (D3, D5 INV-REC + DEP-APPLY). Both insert-only: a mistake is cancelled
-- and reissued. The release posts no journal; the invoice record is the sale, recorded from the manual BIR invoice.

CREATE TABLE jo_releases (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  job_order_id      TEXT NOT NULL REFERENCES jo_orders(document_id),
  claimed_by        TEXT NOT NULL,
  id_seen           TEXT NOT NULL CHECK (id_seen IN ('government_id','school_id','company_id','other_id','none')), -- no ID number stored
  balance_due_cents INTEGER NOT NULL, -- snapshot of the JO's balance due when released
  credit_note       TEXT,
  credit_due_date   TEXT,
  override_reason   TEXT, -- owner released before the job was marked ready (E4 rule 2)
  CHECK ((balance_due_cents > 0) = (credit_note IS NOT NULL) AND (credit_note IS NULL) = (credit_due_date IS NULL))
) STRICT;
CREATE INDEX jo_releases_jo ON jo_releases(job_order_id);

-- The JO lines released, with the released part's price: list = qty × unit price; the line's discount is shared out
-- by quantity, and the release that completes a line takes what is left, so the releases of a line add up to it.
CREATE TABLE jo_release_lines (
  document_id    TEXT NOT NULL REFERENCES jo_releases(document_id),
  line_no        INTEGER NOT NULL CHECK (line_no >= 1), -- jo_lines.line_no of the job order
  qty            INTEGER NOT NULL CHECK (qty > 0),
  list_cents     INTEGER NOT NULL CHECK (list_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents >= 0 AND amount_cents = list_cents - discount_cents),
  PRIMARY KEY (document_id, line_no)
) STRICT;

-- One invoice record per release, for the released part. VAT at document level (D4.1) at the rate in force on the
-- invoice date; sales split by line class; a discount on the JO line is shown on the invoice, so it posts gross + 4190
-- (D4.3). The JO's deposits are applied up to the gross (DEP-APPLY). Deposit VAT modes B and C are refused until built.
CREATE TABLE jo_invoice_records (
  document_id           TEXT PRIMARY KEY REFERENCES documents(id),
  release_id            TEXT NOT NULL REFERENCES jo_releases(document_id),
  job_order_id          TEXT NOT NULL REFERENCES jo_orders(document_id),
  customer_id           TEXT NOT NULL,
  customer_name         TEXT NOT NULL, -- as it read when recorded
  invoice_number        TEXT NOT NULL, -- manual BIR invoice number as typed; used once, ever
  vat_rate_bp           INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  deposit_vat_mode      TEXT NOT NULL CHECK (deposit_vat_mode IN ('A','B','C')),
  list_cents            INTEGER NOT NULL CHECK (list_cents >= 0),
  discount_cents        INTEGER NOT NULL CHECK (discount_cents >= 0),
  gross_cents           INTEGER NOT NULL CHECK (gross_cents > 0 AND gross_cents = list_cents - discount_cents),
  vat_cents             INTEGER NOT NULL CHECK (vat_cents >= 0),
  discount_net_cents    INTEGER NOT NULL CHECK (discount_net_cents >= 0),
  sales_mto_cents       INTEGER NOT NULL CHECK (sales_mto_cents >= 0),
  sales_rtw_cents       INTEGER NOT NULL CHECK (sales_rtw_cents >= 0),
  sales_service_cents   INTEGER NOT NULL CHECK (sales_service_cents >= 0),
  deposit_applied_cents INTEGER NOT NULL CHECK (deposit_applied_cents BETWEEN 0 AND gross_cents),
  note                  TEXT,
  CHECK (sales_mto_cents + sales_rtw_cents + sales_service_cents = gross_cents - vat_cents + discount_net_cents)
) STRICT;
-- A cancelled invoice keeps its number ("cancelled, all copies kept", D6), and "0501" and "501" are the same paper.
CREATE UNIQUE INDEX jo_invoice_records_number ON jo_invoice_records(CAST(invoice_number AS INTEGER));
CREATE INDEX jo_invoice_records_release ON jo_invoice_records(release_id);
CREATE INDEX jo_invoice_records_jo ON jo_invoice_records(job_order_id);

CREATE TRIGGER jo_releases_no_update BEFORE UPDATE ON jo_releases
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded releases are cancelled and reissued, never edited'); END;
CREATE TRIGGER jo_release_lines_no_update BEFORE UPDATE ON jo_release_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded releases are cancelled and reissued, never edited'); END;
CREATE TRIGGER jo_invoice_records_no_update BEFORE UPDATE ON jo_invoice_records
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded invoice records are cancelled and reissued, never edited'); END;
