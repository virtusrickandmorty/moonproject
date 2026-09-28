-- Government loans (PLAN D5 PAY-RUN 2404/2405, PAY 0003): a remittance pays the month's contributions and loans of one agency together. payable_cents and amount_cents of a
-- line stay the employee's totals; these are the loan parts within them (0 for PhilHealth and the BIR).
ALTER TABLE stat_remittance_lines ADD COLUMN loan_payable_cents INTEGER NOT NULL DEFAULT 0 CHECK (loan_payable_cents >= 0 AND loan_payable_cents <= payable_cents);
ALTER TABLE stat_remittance_lines ADD COLUMN loan_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (loan_amount_cents >= 0 AND loan_amount_cents <= amount_cents AND loan_amount_cents <= loan_payable_cents);
