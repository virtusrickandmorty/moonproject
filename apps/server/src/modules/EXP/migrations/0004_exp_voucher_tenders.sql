-- Split tenders (PLAN E9 "tenders (petty cash allowed)", D5 EXP-PAY "Cash X (per tender)"): an expense voucher is paid
-- from one to four cash places, one row each in exp_voucher_tenders, and their amounts add up to cash_cents (the receipt
-- less any EWT withheld). Every voucher already recorded keeps its figures and its journal: its single cash place becomes
-- tender 1 for the amount it credited (cash_cents), so nothing that posted changes. No journal is touched here.
--
-- exp_vouchers.cash_account_id is dropped: the cash places now live only in the tender rows, so the two can never
-- disagree. SQLite cannot drop a column that carries a foreign key, so the table is recreated (as CA 0002 did). The
-- tender rows are created after the rename so their foreign key points at the final table.
CREATE TABLE exp_vouchers_new (
  document_id           TEXT PRIMARY KEY REFERENCES documents(id),
  category_id           INTEGER NOT NULL REFERENCES exp_categories(id),
  expense_account_id    INTEGER NOT NULL REFERENCES accounts(id),
  supplier_id           TEXT,                 -- a PUR supplier, or NULL for a one-off payee
  payee_name            TEXT NOT NULL,
  payee_tin             TEXT,
  payee_vat_registered  INTEGER NOT NULL CHECK (payee_vat_registered IN (0,1)),
  tax_party_id          TEXT,                 -- party id on 1401/2311: the supplier id, or 'tin:' + digits for a one-off payee
  description           TEXT NOT NULL,
  supplier_invoice_no   TEXT,
  supplier_invoice_date TEXT,
  gross_cents           INTEGER NOT NULL CHECK (gross_cents > 0),
  vat_rate_bp           INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  expense_cents         INTEGER NOT NULL CHECK (expense_cents > 0),
  input_vat_cents       INTEGER NOT NULL CHECK (input_vat_cents >= 0),
  ewt_class             TEXT,
  ewt_rate_bp           INTEGER NOT NULL CHECK (ewt_rate_bp >= 0),
  ewt_base_cents        INTEGER NOT NULL CHECK (ewt_base_cents >= 0),
  ewt_cents             INTEGER NOT NULL CHECK (ewt_cents >= 0),
  cash_cents            INTEGER NOT NULL CHECK (cash_cents > 0), -- paid out: Σ of the tender rows
  CHECK (expense_cents + input_vat_cents = gross_cents),
  CHECK (cash_cents + ewt_cents = gross_cents),
  CHECK ((ewt_class IS NULL) = (ewt_rate_bp = 0)),
  CHECK (ewt_class IS NOT NULL OR ewt_cents = 0),
  CHECK (tax_party_id IS NOT NULL OR (input_vat_cents = 0 AND ewt_cents = 0))
) STRICT;

-- Old vouchers' tender 1, read from the old table before it goes.
CREATE TEMP TABLE exp_old_tenders AS SELECT document_id, cash_account_id, cash_cents FROM exp_vouchers;

INSERT INTO exp_vouchers_new
  SELECT document_id, category_id, expense_account_id, supplier_id, payee_name, payee_tin, payee_vat_registered, tax_party_id, description,
         supplier_invoice_no, supplier_invoice_date, gross_cents, vat_rate_bp, expense_cents, input_vat_cents, ewt_class, ewt_rate_bp,
         ewt_base_cents, ewt_cents, cash_cents
  FROM exp_vouchers;
DROP TABLE exp_vouchers;
ALTER TABLE exp_vouchers_new RENAME TO exp_vouchers;
CREATE INDEX exp_vouchers_invoice ON exp_vouchers(tax_party_id, supplier_invoice_no);
CREATE TRIGGER exp_vouchers_no_update BEFORE UPDATE ON exp_vouchers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted expense vouchers are cancelled, never edited'); END;

-- One row per cash place the voucher was paid from (a cash place is its own GL account); line_no 1..4.
CREATE TABLE exp_voucher_tenders (
  document_id  TEXT NOT NULL REFERENCES exp_vouchers(document_id),
  line_no      INTEGER NOT NULL CHECK (line_no BETWEEN 1 AND 4),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference    TEXT, -- GCash or bank reference, or check number and bank
  PRIMARY KEY (document_id, line_no)
) STRICT;
CREATE TRIGGER exp_voucher_tenders_no_update BEFORE UPDATE ON exp_voucher_tenders
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted expense vouchers are cancelled, never edited'); END;

INSERT INTO exp_voucher_tenders (document_id, line_no, account_id, amount_cents, reference)
  SELECT document_id, 1, cash_account_id, cash_cents, NULL FROM exp_old_tenders;
DROP TABLE exp_old_tenders;
