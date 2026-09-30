-- Three busy years (PERF): indexes the lists and reports needed once the books held years of journals. Nothing else changes.
-- Every report reads "the journals of these dates", and the register and book queries ask "does this journal have a line on
-- this account" once per journal; without these two indexes SQLite read the whole of journal_lines for each question.
CREATE INDEX journals_date ON journals(business_date, number);
CREATE INDEX journal_lines_journal_account ON journal_lines(journal_id, account_id);
-- What one job order owes is the balance of the receivable and deposit accounts on that order's lines; lists of every order add
-- those up in one pass, which this index answers without going back to the table for each line's amounts.
CREATE INDEX journal_lines_account_ref_amounts ON journal_lines(account_id, ref_doc_id, journal_id, debit_cents, credit_cents);
