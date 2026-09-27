-- Cash places are made in CASH (the Cash Accounts screen, PLAN D2 and E10): each is its own GL account plus a
-- cash_place_settings row with its kind, the bank account number and who sees its balance (OWN-27).
ALTER TABLE cash_place_settings ADD COLUMN kind TEXT NOT NULL DEFAULT 'cash' CHECK (kind IN ('cash','checks','bank','ewallet'));
ALTER TABLE cash_place_settings ADD COLUMN account_no TEXT; -- banks and e-wallets; shown masked without cash.balances.view_all
ALTER TABLE cash_place_settings ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
UPDATE cash_place_settings SET kind = CASE
  WHEN (SELECT code FROM accounts WHERE id = account_id) = '1103' THEN 'checks'
  WHEN (SELECT code FROM accounts WHERE id = account_id) LIKE '111_' THEN 'bank'
  WHEN (SELECT code FROM accounts WHERE id = account_id) LIKE '112_' THEN 'ewallet'
  ELSE 'cash' END;
CREATE TRIGGER cash_place_settings_fixed BEFORE UPDATE OF account_id, kind ON cash_place_settings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a cash place keeps its account and kind'); END;

-- Cash count (CNT-, D5 CASH-COUNT, G-18): the bills and coins counted in one cash box against its ledger balance.
CREATE TABLE cash_counts (
  document_id      TEXT PRIMARY KEY REFERENCES documents(id),
  cash_account_id  INTEGER NOT NULL REFERENCES accounts(id),
  counted_cents    INTEGER NOT NULL CHECK (counted_cents >= 0),
  ledger_cents     INTEGER NOT NULL, -- the balance when the count was recorded
  difference_cents INTEGER NOT NULL, -- over (+) or short (-)
  note             TEXT,
  CHECK (difference_cents = counted_cents - ledger_cents)
) STRICT;
CREATE TABLE cash_count_lines (
  document_id        TEXT NOT NULL REFERENCES cash_counts(document_id),
  denomination_cents INTEGER NOT NULL CHECK (denomination_cents > 0),
  qty                INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (document_id, denomination_cents)
) STRICT;
CREATE TRIGGER cash_counts_no_update BEFORE UPDATE ON cash_counts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded counts are cancelled, never edited'); END;
CREATE TRIGGER cash_count_lines_no_update BEFORE UPDATE ON cash_count_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded counts are cancelled, never edited'); END;

-- Other receipt (ORC-, D5 OTH-RCV): money in that is not a sale (interest, other income, money owed to the shop).
CREATE TABLE cash_other_receipts (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  category        TEXT NOT NULL CHECK (category IN ('interest','other_income','other_receivable')),
  received_from   TEXT NOT NULL,
  description     TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  reference       TEXT,
  note            TEXT
) STRICT;
CREATE TRIGGER cash_other_receipts_no_update BEFORE UPDATE ON cash_other_receipts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded receipts are cancelled, never edited'); END;
