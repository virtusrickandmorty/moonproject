-- AP module tables (prefix ap_). Rows are insert-only: a bill or a payment is cancelled, never edited.
-- What is still owed on a bill is never stored: it is read from the ledger (2101 lines with the bill as ref_doc_id).

-- Supplier bill (BILL-, PLAN D5 BILL-POST). Figures are stored as computed; a cancel mirrors the journal.
CREATE TABLE ap_bills (
  document_id           TEXT PRIMARY KEY REFERENCES documents(id),
  supplier_id           TEXT NOT NULL,        -- a PUR supplier
  supplier_invoice_no   TEXT NOT NULL,
  supplier_invoice_date TEXT NOT NULL,
  due_date              TEXT NOT NULL CHECK (due_date >= supplier_invoice_date),
  receiving_report_id   TEXT,                 -- a PUR receiving report (RR-), or NULL
  vat_registered        INTEGER NOT NULL CHECK (vat_registered IN (0,1)),
  vat_rate_bp           INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  gross_cents           INTEGER NOT NULL CHECK (gross_cents > 0),
  input_vat_cents       INTEGER NOT NULL CHECK (input_vat_cents >= 0),
  ewt_class             TEXT,
  ewt_rate_bp           INTEGER NOT NULL CHECK (ewt_rate_bp >= 0),
  ewt_base_cents        INTEGER NOT NULL CHECK (ewt_base_cents >= 0),
  ewt_cents             INTEGER NOT NULL CHECK (ewt_cents >= 0),
  payable_cents         INTEGER NOT NULL CHECK (payable_cents > 0),
  note                  TEXT,
  CHECK (payable_cents + ewt_cents = gross_cents),
  CHECK (ewt_class IS NOT NULL OR (ewt_rate_bp = 0 AND ewt_cents = 0))
) STRICT;
CREATE INDEX ap_bills_invoice ON ap_bills(supplier_id, supplier_invoice_no);
CREATE INDEX ap_bills_rr ON ap_bills(receiving_report_id);

-- One row per invoice line: a supply (5101/5102), subcontracting (5301), freight-in (5103) or an expense category.
CREATE TABLE ap_bill_lines (
  document_id   TEXT NOT NULL REFERENCES ap_bills(document_id),
  line_no       INTEGER NOT NULL CHECK (line_no >= 1),
  supply_id     TEXT,
  category_id   INTEGER,
  purchase      TEXT CHECK (purchase IN ('subcontract', 'freight_in')),
  cost_role     TEXT,                          -- the account posted to: a role key (supplies, subcontracting, freight) ...
  account_id    INTEGER REFERENCES accounts(id), -- ... or the expense category's account
  description   TEXT,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  vat_cents     INTEGER NOT NULL CHECK (vat_cents >= 0 AND vat_cents <= amount_cents),
  PRIMARY KEY (document_id, line_no),
  CHECK ((supply_id IS NOT NULL) + (category_id IS NOT NULL) + (purchase IS NOT NULL) = 1),
  CHECK ((cost_role IS NULL) <> (account_id IS NULL))
) STRICT;

-- Supplier payment (SPAY-, PLAN D5 BILL-PAY): Σ tenders = Σ bills paid + bank fee.
CREATE TABLE ap_payments (
  document_id  TEXT PRIMARY KEY REFERENCES documents(id),
  supplier_id  TEXT NOT NULL,
  fee_cents    INTEGER NOT NULL CHECK (fee_cents >= 0),
  note         TEXT
) STRICT;

CREATE TABLE ap_payment_bills (
  document_id  TEXT NOT NULL REFERENCES ap_payments(document_id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  bill_id      TEXT NOT NULL REFERENCES ap_bills(document_id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (document_id, line_no)
) STRICT;
CREATE INDEX ap_payment_bills_bill ON ap_payment_bills(bill_id);

-- One row per tender: the cash place the money left (a cash place is its own GL account).
CREATE TABLE ap_payment_tenders (
  document_id  TEXT NOT NULL REFERENCES ap_payments(document_id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference    TEXT,                           -- check number, bank or GCash reference
  PRIMARY KEY (document_id, line_no)
) STRICT;

CREATE TRIGGER ap_bills_no_update BEFORE UPDATE ON ap_bills BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted supplier bills are cancelled, never edited'); END;
CREATE TRIGGER ap_bill_lines_no_update BEFORE UPDATE ON ap_bill_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted supplier bills are cancelled, never edited'); END;
CREATE TRIGGER ap_payments_no_update BEFORE UPDATE ON ap_payments BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted supplier payments are cancelled, never edited'); END;
CREATE TRIGGER ap_payment_bills_no_update BEFORE UPDATE ON ap_payment_bills BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted supplier payments are cancelled, never edited'); END;
CREATE TRIGGER ap_payment_tenders_no_update BEFORE UPDATE ON ap_payment_tenders BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted supplier payments are cancelled, never edited'); END;
