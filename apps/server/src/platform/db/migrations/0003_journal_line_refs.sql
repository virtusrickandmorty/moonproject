-- A journal line may name the document it is for, e.g. the job order behind a deposit or a receivable
-- (PLAN D3, G-01 "party Test School, JO"), so a module can read its share of an account from the ledger.
-- ADD COLUMN keeps the table and every trigger on it: lines are still insert-only and never updated.
-- Mirrored reversals copy the reference (post.ts).
ALTER TABLE journal_lines ADD COLUMN ref_doc_id TEXT REFERENCES documents(id);
CREATE INDEX journal_lines_account_ref ON journal_lines(account_id, ref_doc_id);
