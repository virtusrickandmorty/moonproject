-- Opening balances, part 1 (PLAN D8 "Cut-over", MIG-02): the cut-over date, the OB- documents for balances that need
-- no subledger document (cash places, inventories, prepayments, equity), and the close. All insert-only.

-- The cut-over date. The newest row counts (ties: latest id); a change adds a row. Set by the accountant with a fresh
-- password, audited, refused once the opening is closed.
CREATE TABLE acc_cutover_dates (
  id           INTEGER PRIMARY KEY,
  cutover_date TEXT NOT NULL CHECK (cutover_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE TRIGGER acc_cutover_dates_no_update BEFORE UPDATE ON acc_cutover_dates
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: the cut-over date changes by adding a row'); END;

-- Opening Balances (OB-): the typed lines, and the 3900 opening balance equity line the document adds for the
-- difference (at most one side is non-zero; both zero when the typed lines balance by themselves).
CREATE TABLE acc_openings (
  document_id         TEXT PRIMARY KEY REFERENCES documents(id),
  equity_debit_cents  INTEGER NOT NULL CHECK (equity_debit_cents >= 0),
  equity_credit_cents INTEGER NOT NULL CHECK (equity_credit_cents >= 0),
  CHECK (equity_debit_cents = 0 OR equity_credit_cents = 0)
) STRICT;

CREATE TABLE acc_opening_lines (
  document_id    TEXT NOT NULL REFERENCES acc_openings(document_id),
  line_no        INTEGER NOT NULL CHECK (line_no >= 1),
  account_id     INTEGER NOT NULL REFERENCES accounts(id),
  stockholder_id TEXT, -- the party on an equity account kept per stockholder (3101 capital stock and the like)
  debit_cents    INTEGER NOT NULL CHECK (debit_cents >= 0),
  credit_cents   INTEGER NOT NULL CHECK (credit_cents >= 0),
  memo           TEXT,
  PRIMARY KEY (document_id, line_no),
  CHECK ((debit_cents > 0) <> (credit_cents > 0))
) STRICT;

CREATE TRIGGER acc_openings_no_update BEFORE UPDATE ON acc_openings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded opening balances are cancelled and reissued, never edited'); END;
CREATE TRIGGER acc_opening_lines_no_update BEFORE UPDATE ON acc_opening_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded opening balances are cancelled and reissued, never edited'); END;

-- The close of the opening (D8 step 4: the accountant signs off the opening TB). One row, ever: who closed it, when,
-- for which cut-over date, and the trial balance totals on that date.
CREATE TABLE acc_opening_closes (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  cutover_date       TEXT NOT NULL,
  closed_at          TEXT NOT NULL,
  closed_by          TEXT NOT NULL REFERENCES users(id),
  total_debit_cents  INTEGER NOT NULL,
  total_credit_cents INTEGER NOT NULL,
  CHECK (total_debit_cents = total_credit_cents)
) STRICT;
CREATE TRIGGER acc_opening_closes_no_update BEFORE UPDATE ON acc_opening_closes
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: the opening close is never edited'); END;
