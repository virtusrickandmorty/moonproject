-- What a loan's schedule keeps from before its amortization changed (the ERP review, Nov 2026): months already handled
-- stay at the amount they were scheduled at, so a change only moves the months still to come.
ALTER TABLE pay_gov_loans ADD COLUMN scheduled_offset_cents INTEGER NOT NULL DEFAULT 0;
