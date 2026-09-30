-- Three busy years (PERF): indexes the lists and reports needed once the books held years of journals. Nothing else changes.
-- Every report reads "the journals of these dates", and the register and book queries ask "does this journal have a line on
-- this account" once per journal; without these two indexes SQLite read the whole of journal_lines for each question.
CREATE INDEX journals_date ON journals(business_date, number);
CREATE INDEX journal_lines_journal_account ON journal_lines(journal_id, account_id);
-- The receivable and deposit accounts are added up per job order and per customer by the lists, the aging and the dashboards; this
-- index holds everything those sums read (order, journal, party and both amounts), so they never go back to the table for a line.
CREATE INDEX journal_lines_account_ref_amounts ON journal_lines(account_id, ref_doc_id, journal_id, party_type, party_id, debit_cents, credit_cents);
