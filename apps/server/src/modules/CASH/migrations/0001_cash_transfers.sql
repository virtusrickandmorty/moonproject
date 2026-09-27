-- CASH module tables (prefix cash_). Posted rows are insert-only.
CREATE TABLE cash_transfers (
  document_id           TEXT PRIMARY KEY REFERENCES documents(id),
  from_account_id       INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id         INTEGER NOT NULL REFERENCES accounts(id),
  amount_sent_cents     INTEGER NOT NULL CHECK (amount_sent_cents > 0),
  amount_received_cents INTEGER NOT NULL CHECK (amount_received_cents > 0),
  fee_cents             INTEGER NOT NULL CHECK (fee_cents >= 0),
  note                  TEXT,
  CHECK (from_account_id <> to_account_id),
  CHECK (fee_cents = amount_sent_cents - amount_received_cents)
) STRICT;
CREATE TRIGGER cash_transfers_no_update BEFORE UPDATE ON cash_transfers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted transfers are cancelled, never edited'); END;

-- Which cash places show their balance to users without cash.balances.view_all (OWN-27 default).
CREATE TABLE cash_place_settings (
  account_id           INTEGER PRIMARY KEY REFERENCES accounts(id),
  encoder_sees_balance INTEGER NOT NULL DEFAULT 0 CHECK (encoder_sees_balance IN (0,1))
) STRICT;
INSERT INTO cash_place_settings (account_id, encoder_sees_balance)
  SELECT id, CASE WHEN code IN ('1101','1102') THEN 1 ELSE 0 END FROM accounts WHERE is_cash_place = 1;
