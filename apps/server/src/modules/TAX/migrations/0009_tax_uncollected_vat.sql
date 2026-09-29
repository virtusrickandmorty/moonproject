-- Output VAT on uncollected receivables (EOPT law, RR 3-2024, RMC 65-2024; PLAN E12, K ACC-26).
-- A claim (UVAT-) takes the output VAT of what a credit sale still owes off the quarter after its agreed time to pay
-- ended: Dr 2301 / Cr 2303, party the customer, ref the invoice. A recovery (UVATR-) adds back the part the customer
-- paid later: Dr 2303 / Cr 2301. Figures are stored as computed and the requisites the accountant confirmed with them.
CREATE TABLE tax_uncollected_vat (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  invoice_id        TEXT NOT NULL REFERENCES documents(id),  -- the release's invoice record (JO, IR-)
  customer_id       TEXT NOT NULL,
  invoice_date      TEXT NOT NULL,
  due_date          TEXT NOT NULL,                           -- the agreed time to pay ends
  gross_cents       INTEGER NOT NULL CHECK (gross_cents > 0),
  invoice_vat_cents INTEGER NOT NULL CHECK (invoice_vat_cents > 0),
  owed_cents        INTEGER NOT NULL CHECK (owed_cents > 0),  -- still owed on the invoice when claimed
  credited_cents    INTEGER NOT NULL CHECK (credited_cents >= 0), -- credit memos, write-offs, 2307s on it by then
  vat_cents         INTEGER NOT NULL CHECK (vat_cents > 0 AND vat_cents <= invoice_vat_cents),
  -- The requisites the books cannot check, confirmed by the accountant.
  written_agreement INTEGER NOT NULL CHECK (written_agreement = 1),
  listed_in_slsp    INTEGER NOT NULL CHECK (listed_in_slsp = 1),
  declared_on_time  INTEGER NOT NULL CHECK (declared_on_time = 1),
  not_bad_debt      INTEGER NOT NULL CHECK (not_bad_debt = 1),
  note              TEXT
) STRICT;
CREATE INDEX tax_uncollected_vat_invoice ON tax_uncollected_vat(invoice_id);
CREATE TRIGGER tax_uncollected_vat_no_update BEFORE UPDATE ON tax_uncollected_vat
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a claim of output VAT on an uncollected receivable is cancelled, never edited'); END;

CREATE TABLE tax_uncollected_vat_recoveries (
  document_id    TEXT PRIMARY KEY REFERENCES documents(id),
  claim_id       TEXT NOT NULL REFERENCES tax_uncollected_vat(document_id),
  invoice_id     TEXT NOT NULL REFERENCES documents(id),
  customer_id    TEXT NOT NULL,
  owed_cents     INTEGER NOT NULL CHECK (owed_cents >= 0),    -- still owed on the invoice when recovered
  credited_cents INTEGER NOT NULL CHECK (credited_cents >= 0),
  vat_cents      INTEGER NOT NULL CHECK (vat_cents > 0),
  note           TEXT
) STRICT;
CREATE INDEX tax_uncollected_vat_recoveries_claim ON tax_uncollected_vat_recoveries(claim_id);
CREATE TRIGGER tax_uncollected_vat_recoveries_no_update BEFORE UPDATE ON tax_uncollected_vat_recoveries
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an add-back of output VAT is cancelled, never edited'); END;

-- ACC-26 default: off. The accountant decides whether Virtus claims the credit, and turns it on from a date with a new
-- version of this setting (POST /api/settings/tax.uncollected_vat_credit).
INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES
('tax.uncollected_vat_credit', '2000-01-01', 'false', 'Default at install: output VAT on uncollected receivables is not claimed until the accountant decides (PLAN ACC-26)', '2026-09-28T00:00:00.000+08:00');
