-- A repayment may be applied to one cash advance (the owner's request, Nov 2026): that advance is paid by it, so once
-- paid in full the payroll stops deducting its instalment (advanceSchedule). NULL: not a particular one, as before.
ALTER TABLE ca_repayments ADD COLUMN advance_id TEXT REFERENCES documents(id);
CREATE INDEX ca_repayments_advance ON ca_repayments(advance_id);
