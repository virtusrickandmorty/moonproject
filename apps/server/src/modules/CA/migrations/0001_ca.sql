-- CA module tables (prefix ca_), PLAN E11 and D5 CA-GIVE. The CA ledger per employee is GL 1210 (party employee),
-- read from journals; these rows only keep what was given and the instalment planned per payroll (OWN-09).
CREATE TABLE ca_advances (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  employee_id       TEXT NOT NULL,
  employee_name     TEXT NOT NULL, -- as it read when recorded
  cash_account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  installment_cents INTEGER NOT NULL CHECK (installment_cents > 0 AND installment_cents <= amount_cents),
  note              TEXT
) STRICT;
CREATE INDEX ca_advances_employee ON ca_advances(employee_id);
CREATE TRIGGER ca_advances_no_update BEFORE UPDATE ON ca_advances
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded cash advances are cancelled, never edited'); END;
