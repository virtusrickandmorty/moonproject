-- Opening Cash Advance (OBCA-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): what an employee still owed on cash advances
-- on the cut-over date, stored as a row in ca_advances like any advance, so advanceSchedule and the payroll deduction
-- read it the same way. cash_account_id is NULL for an opening: the credit side is 3900 opening balance equity, not a
-- cash place. SQLite has no ALTER COLUMN to drop a NOT NULL, so the table is recreated.
CREATE TABLE ca_advances_new (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  employee_id       TEXT NOT NULL,
  employee_name     TEXT NOT NULL, -- as it read when recorded
  cash_account_id   INTEGER REFERENCES accounts(id), -- NULL for an opening cash advance
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  installment_cents INTEGER NOT NULL CHECK (installment_cents > 0 AND installment_cents <= amount_cents),
  note              TEXT
) STRICT;
INSERT INTO ca_advances_new SELECT document_id, employee_id, employee_name, cash_account_id, amount_cents, installment_cents, note FROM ca_advances;
DROP TABLE ca_advances;
ALTER TABLE ca_advances_new RENAME TO ca_advances;
CREATE INDEX ca_advances_employee ON ca_advances(employee_id);
CREATE TRIGGER ca_advances_no_update BEFORE UPDATE ON ca_advances
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded cash advances are cancelled, never edited'); END;
