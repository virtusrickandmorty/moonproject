-- The semi-monthly pay periods (PLAN F2; the owner's decision, Oct 9, 2026): 1–15 and 16–end until now; from 16 October
-- 2026, 26th–10th (paid on the 15th) and 11th–25th (paid at month end), so each payroll is worked out a few days before
-- payday. The change day opens a short period, October 16–25, and the first full one is October 26 to November 10
-- (PAY run-calc.ts periodEndOf), so no day is paid twice or left out.
INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES
('pay.semi_monthly_cutoff', '2000-01-01', '"calendar"', 'Semi-monthly pay periods 1–15 and 16–end (PLAN F2)', '2026-10-09T00:00:00.000+08:00'),
('pay.semi_monthly_cutoff', '2026-10-16', '"10_25"', 'The owner''s decision (Oct 9, 2026): cut-offs on the 10th and 25th, paid on the 15th and at month end', '2026-10-09T00:00:00.000+08:00');
