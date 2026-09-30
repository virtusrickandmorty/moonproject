-- Reversing journal vouchers (PLAN E12 "reversal-on-date option for accruals"). A JV may be marked to reverse on the
-- first day of the next month (reverse_on); from that day it is in the "Reversals due" list until a JV that reverses it
-- (reverses_id) is recorded by the accountant, never automatically. A JV is reversed at most once while its reversal
-- stands: validate checks it inside the posting transaction, and the original cannot be cancelled while it stands.
ALTER TABLE acc_journal_vouchers ADD COLUMN reverse_on TEXT CHECK (reverse_on IS NULL OR reverse_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-01');
ALTER TABLE acc_journal_vouchers ADD COLUMN reverses_id TEXT REFERENCES documents(id);
CREATE INDEX acc_journal_vouchers_reverse_on ON acc_journal_vouchers(reverse_on) WHERE reverse_on IS NOT NULL;
CREATE INDEX acc_journal_vouchers_reverses ON acc_journal_vouchers(reverses_id) WHERE reverses_id IS NOT NULL;
