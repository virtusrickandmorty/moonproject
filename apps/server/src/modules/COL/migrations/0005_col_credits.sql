-- Customer credits without cash (PLAN D5 CWT-ONLY, DEP-FORFEIT, CM-ALLOW, BAD-DEBT; E5 "other documents").
-- invoice_id is a recorded invoice: a release's invoice record (jo.invoice_record) or a quick sale (qs.sale). Its
-- receivable lines name the job order or the sale, so ar_ref_id keeps which one these documents credit.
-- All insert-only: a mistake is cancelled (mirror journal) and reissued.

-- 2307 received with no cash (CWT-ONLY): tax a customer withheld on an invoice it paid net. Dr 1410 / Cr 1201.
CREATE TABLE col_cwt_only (
  document_id   TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id   TEXT NOT NULL,
  customer_name TEXT NOT NULL, -- as it read when recorded
  invoice_id    TEXT NOT NULL REFERENCES documents(id),
  ar_ref_id     TEXT NOT NULL REFERENCES documents(id),
  cwt_cents     INTEGER NOT NULL CHECK (cwt_cents > 0),
  atc           TEXT NOT NULL CHECK (atc IN ('WC158','WC160','other')),
  period_year   INTEGER NOT NULL CHECK (period_year BETWEEN 2000 AND 2999),
  period_quarter INTEGER NOT NULL CHECK (period_quarter BETWEEN 1 AND 4),
  note          TEXT
) STRICT;
CREATE INDEX col_cwt_only_invoice ON col_cwt_only(invoice_id);

-- Deposit forfeit (DEP-FORFEIT): a job order's deposit kept when the customer abandons it. Dr 2201 / Cr 7103 (+ Cr 2301
-- when the accountant's dated setting col.forfeit_vatable says so, ACC-15). marked_abandoned: this forfeit closed the JO.
CREATE TABLE col_forfeits (
  document_id      TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id      TEXT NOT NULL,
  customer_name    TEXT NOT NULL,
  job_order_id     TEXT NOT NULL REFERENCES documents(id),
  vatable          INTEGER NOT NULL CHECK (vatable IN (0,1)),
  vat_rate_bp      INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  vat_cents        INTEGER NOT NULL CHECK (vat_cents >= 0 AND (vatable = 1 OR vat_cents = 0)),
  marked_abandoned INTEGER NOT NULL CHECK (marked_abandoned IN (0,1)),
  reason           TEXT NOT NULL
) STRICT;
CREATE INDEX col_forfeits_jo ON col_forfeits(job_order_id);

-- Credit memo (CM-, CM-ALLOW): a return or allowance on a recorded invoice, by the accountant. Amount = documents.total_cents
-- = net_cents + vat_cents = ar_cents + credit_cents: Dr 4191 net, Dr 2301 VAT / Cr 1201 what the invoice still owed,
-- Cr 2201 the part already paid (customer credit). VAT at the invoice's own rate.
CREATE TABLE col_credit_memos (
  document_id   TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id   TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  invoice_id    TEXT NOT NULL REFERENCES documents(id),
  ar_ref_id     TEXT NOT NULL REFERENCES documents(id),
  job_order_id  TEXT REFERENCES documents(id), -- the JO the customer credit is held for; NULL for a quick sale (unapplied)
  kind          TEXT NOT NULL CHECK (kind IN ('return','allowance')),
  form_number   TEXT, -- the accountant's manual credit memo form number, if one is used (ACC-08)
  vat_rate_bp   INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  net_cents     INTEGER NOT NULL CHECK (net_cents >= 0),
  vat_cents     INTEGER NOT NULL CHECK (vat_cents >= 0),
  ar_cents      INTEGER NOT NULL CHECK (ar_cents >= 0),
  credit_cents  INTEGER NOT NULL CHECK (credit_cents >= 0),
  reason        TEXT NOT NULL,
  CHECK (net_cents + vat_cents = ar_cents + credit_cents AND net_cents + vat_cents > 0)
) STRICT;
CREATE INDEX col_credit_memos_invoice ON col_credit_memos(invoice_id);
-- A form number is used once, cancelled ones included, and "0012" and "12" are the same paper.
CREATE UNIQUE INDEX col_credit_memos_form ON col_credit_memos(CAST(form_number AS INTEGER)) WHERE form_number IS NOT NULL;

-- Bad debt write-off (BAD-DEBT): all an invoice still owes, by the accountant. Dr 6270 / Cr 1201. Output VAT stays.
CREATE TABLE col_write_offs (
  document_id   TEXT PRIMARY KEY REFERENCES documents(id),
  customer_id   TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  invoice_id    TEXT NOT NULL REFERENCES documents(id),
  ar_ref_id     TEXT NOT NULL REFERENCES documents(id),
  reason        TEXT NOT NULL
) STRICT;
CREATE INDEX col_write_offs_invoice ON col_write_offs(invoice_id);

CREATE TRIGGER col_cwt_only_no_update BEFORE UPDATE ON col_cwt_only
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded 2307s are cancelled and reissued, never edited'); END;
CREATE TRIGGER col_forfeits_no_update BEFORE UPDATE ON col_forfeits
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded forfeits are cancelled and reissued, never edited'); END;
CREATE TRIGGER col_credit_memos_no_update BEFORE UPDATE ON col_credit_memos
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded credit memos are cancelled and reissued, never edited'); END;
CREATE TRIGGER col_write_offs_no_update BEFORE UPDATE ON col_write_offs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded write-offs are cancelled and reissued, never edited'); END;

-- ACC-15 default: a forfeited deposit is other income, not VATable. The accountant makes it VATable from a date with a
-- new version of this setting (POST /api/settings/col.forfeit_vatable).
INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES
('col.forfeit_vatable', '2000-01-01', 'false', 'Default at install: forfeited deposits are not VATable (PLAN ACC-15)', '2026-09-28T00:00:00.000+08:00');
