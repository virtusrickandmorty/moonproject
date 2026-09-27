-- STAT module tables (prefix stat_), PLAN E11 and D5 STAT-REM. The payables themselves are journal lines: payroll runs
-- credit them per employee for their contribution month (PAY), and a remittance debits the same month's lines.

-- Statutory remittance (REM-): one payment to SSS, PhilHealth, Pag-IBIG or the BIR (1601-C) for one contribution month.
CREATE TABLE stat_remittances (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  scheme          TEXT NOT NULL CHECK (scheme IN ('SSS','PHIC','HDMF','WTAX')),
  month           TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'), -- the contribution month (PAY M)
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  reference       TEXT NOT NULL, -- PRN, payment reference or receipt number
  payable_cents   INTEGER NOT NULL CHECK (payable_cents > 0), -- what the month's payrolls left to remit when recorded
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= payable_cents),
  note            TEXT
) STRICT;
CREATE INDEX stat_remittances_month ON stat_remittances(scheme, month);

-- What the remittance cleared per employee (the variance check's detail).
CREATE TABLE stat_remittance_lines (
  document_id   TEXT NOT NULL REFERENCES stat_remittances(document_id),
  employee_id   TEXT NOT NULL,
  employee_name TEXT NOT NULL, -- as it read when recorded
  payable_cents INTEGER NOT NULL CHECK (payable_cents > 0),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= payable_cents),
  PRIMARY KEY (document_id, employee_id)
) STRICT;

CREATE TRIGGER stat_remittances_no_update BEFORE UPDATE ON stat_remittances
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded remittances are cancelled, never edited'); END;
CREATE TRIGGER stat_remittance_lines_no_update BEFORE UPDATE ON stat_remittance_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded remittances are cancelled, never edited'); END;
