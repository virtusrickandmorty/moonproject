-- EXP module tables (prefix exp_). Voucher rows are insert-only.

-- Expense categories (PLAN D2 "each is an expense category encoders pick; category -> account is fixed", NR-8).
-- The name shown is the account's name, so an accountant's rename shows everywhere. Payroll (6101-6103),
-- depreciation (6210), bad debts (6270) and cash short and over (6280) have their own documents, so they are left out.
CREATE TABLE exp_categories (
  id                INTEGER PRIMARY KEY,
  account_id        INTEGER NOT NULL UNIQUE REFERENCES accounts(id),
  default_ewt_class TEXT CHECK (default_ewt_class IN ('rent_5', 'contractor_2', 'prof_ind_5', 'prof_ind_10', 'prof_firm_10', 'prof_firm_15', 'goods_1', 'services_2')),
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order        INTEGER NOT NULL
) STRICT;
INSERT INTO exp_categories (account_id, default_ewt_class, sort_order)
  SELECT id, CASE code WHEN '6110' THEN 'rent_5' END, sort_order FROM accounts
  WHERE code IN ('6104', '6110', '6120', '6121', '6130', '6140', '6141', '6150', '6160', '6170', '6180', '6190', '6195',
                 '6220', '6230', '6240', '6250', '6260', '6290', '6990');

-- Expense voucher (EXP-PAY): paid now from one cash place. Figures are stored as computed; a cancel mirrors the journal.
CREATE TABLE exp_vouchers (
  document_id           TEXT PRIMARY KEY REFERENCES documents(id),
  category_id           INTEGER NOT NULL REFERENCES exp_categories(id),
  expense_account_id    INTEGER NOT NULL REFERENCES accounts(id),
  cash_account_id       INTEGER NOT NULL REFERENCES accounts(id),
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
  cash_cents            INTEGER NOT NULL CHECK (cash_cents > 0),
  CHECK (expense_cents + input_vat_cents = gross_cents),
  CHECK (cash_cents + ewt_cents = gross_cents),
  CHECK ((ewt_class IS NULL) = (ewt_rate_bp = 0)),
  CHECK (ewt_class IS NOT NULL OR ewt_cents = 0),
  CHECK (tax_party_id IS NOT NULL OR (input_vat_cents = 0 AND ewt_cents = 0))
) STRICT;
CREATE INDEX exp_vouchers_invoice ON exp_vouchers(tax_party_id, supplier_invoice_no);
CREATE TRIGGER exp_vouchers_no_update BEFORE UPDATE ON exp_vouchers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted expense vouchers are cancelled, never edited'); END;
