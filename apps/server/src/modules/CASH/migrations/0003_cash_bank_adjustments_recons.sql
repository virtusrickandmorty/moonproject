-- Final tax the bank withholds on interest (PLAN D5 BANK-ADJ): a dated setting, read on the adjustment's date.
INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES
('tax.interest_final_tax_bp', '2000-01-01', '2000', 'Default at install: 20% final tax on bank interest (PLAN D5 BANK-ADJ)', '2026-09-28T00:00:00.000+08:00');

-- Bank adjustment (BADJ-, D5 BANK-ADJ): a bank charge, or interest earned net of the final tax the bank withheld.
CREATE TABLE cash_bank_adjustments (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  cash_account_id INTEGER NOT NULL REFERENCES accounts(id),
  kind            TEXT NOT NULL CHECK (kind IN ('charge','interest')),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0), -- the charge, or the gross interest
  final_tax_bp    INTEGER NOT NULL CHECK (final_tax_bp >= 0),
  final_tax_cents INTEGER NOT NULL CHECK (final_tax_cents >= 0),
  net_cents       INTEGER NOT NULL,                          -- what the bank credited (interest) or the charge
  description     TEXT NOT NULL,
  note            TEXT,
  CHECK (net_cents = amount_cents - final_tax_cents),
  CHECK (kind = 'interest' OR (final_tax_bp = 0 AND final_tax_cents = 0))
) STRICT;
CREATE TRIGGER cash_bank_adjustments_no_update BEFORE UPDATE ON cash_bank_adjustments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded adjustments are cancelled, never edited'); END;

-- Bank reconciliation (E10), one per bank and statement month. Finished ones are locked; reopening is audited.
CREATE TABLE cash_recons (
  id                   TEXT PRIMARY KEY,
  account_id           INTEGER NOT NULL REFERENCES accounts(id),
  month                TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  ending_balance_cents INTEGER NOT NULL, -- the closing balance printed on the statement
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','finished')),
  created_at           TEXT NOT NULL,
  created_by           TEXT NOT NULL,
  finished_at          TEXT,
  finished_by          TEXT,
  reopened_at          TEXT,
  reopened_by          TEXT,
  reopen_reason        TEXT,
  UNIQUE (account_id, month),
  CHECK ((status = 'finished') = (finished_at IS NOT NULL))
) STRICT;
CREATE TRIGGER cash_recons_fixed BEFORE UPDATE ON cash_recons
WHEN NEW.id IS NOT OLD.id OR NEW.account_id IS NOT OLD.account_id OR NEW.month IS NOT OLD.month
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
  OR (OLD.status = 'finished' AND NEW.status = 'finished')
BEGIN SELECT RAISE(ABORT, 'LOCKED: a finished reconciliation is reopened before it changes'); END;

-- The statement lines, typed or pasted. A wrong line is voided, never deleted or edited.
CREATE TABLE cash_recon_lines (
  id           INTEGER PRIMARY KEY,
  recon_id     TEXT NOT NULL REFERENCES cash_recons(id),
  line_date    TEXT NOT NULL,
  description  TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0), -- money in (+) or out (-) of the bank
  voided       INTEGER NOT NULL DEFAULT 0 CHECK (voided IN (0,1)),
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL
) STRICT;
CREATE INDEX cash_recon_lines_recon ON cash_recon_lines(recon_id);

-- Cleared marks: each tick-match is a group of statement lines and bank journal lines with equal totals. The journal
-- line is only pointed at, never edited. Undoing a match switches its marks off; a line is cleared at most once.
CREATE TABLE cash_recon_cleared (
  id                INTEGER PRIMARY KEY,
  recon_id          TEXT NOT NULL REFERENCES cash_recons(id),
  match_no          INTEGER NOT NULL CHECK (match_no >= 1),
  statement_line_id INTEGER REFERENCES cash_recon_lines(id),
  journal_line_id   INTEGER REFERENCES journal_lines(id),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at        TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  undone_at         TEXT,
  undone_by         TEXT,
  CHECK ((statement_line_id IS NULL) <> (journal_line_id IS NULL))
) STRICT;
CREATE INDEX cash_recon_cleared_recon ON cash_recon_cleared(recon_id, match_no);
CREATE UNIQUE INDEX cash_recon_cleared_journal ON cash_recon_cleared(journal_line_id) WHERE active = 1 AND journal_line_id IS NOT NULL;
CREATE UNIQUE INDEX cash_recon_cleared_statement ON cash_recon_cleared(statement_line_id) WHERE active = 1 AND statement_line_id IS NOT NULL;

-- Lines and marks change only while their reconciliation is open: a void, or a match switched off.
CREATE TRIGGER cash_recon_lines_locked BEFORE INSERT ON cash_recon_lines
WHEN (SELECT status FROM cash_recons WHERE id = NEW.recon_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'LOCKED: the reconciliation is finished'); END;
CREATE TRIGGER cash_recon_lines_void_only BEFORE UPDATE ON cash_recon_lines
WHEN (SELECT status FROM cash_recons WHERE id = OLD.recon_id) IS NOT 'open' OR NOT (OLD.voided = 0 AND NEW.voided = 1)
  OR NEW.recon_id IS NOT OLD.recon_id OR NEW.line_date IS NOT OLD.line_date OR NEW.description IS NOT OLD.description
  OR NEW.amount_cents IS NOT OLD.amount_cents
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a statement line is only voided, while its reconciliation is open'); END;
CREATE TRIGGER cash_recon_cleared_locked BEFORE INSERT ON cash_recon_cleared
WHEN (SELECT status FROM cash_recons WHERE id = NEW.recon_id) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'LOCKED: the reconciliation is finished'); END;
CREATE TRIGGER cash_recon_cleared_undo_only BEFORE UPDATE ON cash_recon_cleared
WHEN (SELECT status FROM cash_recons WHERE id = OLD.recon_id) IS NOT 'open' OR NOT (OLD.active = 1 AND NEW.active = 0)
  OR NEW.recon_id IS NOT OLD.recon_id OR NEW.match_no IS NOT OLD.match_no
  OR NEW.statement_line_id IS NOT OLD.statement_line_id OR NEW.journal_line_id IS NOT OLD.journal_line_id
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a cleared mark is only switched off, while its reconciliation is open'); END;
