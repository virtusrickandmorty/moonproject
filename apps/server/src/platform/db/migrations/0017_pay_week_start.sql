-- The weekday the weekly piece payroll starts on (PLAN F2; the owner's decision, Oct 9, 2026): Monday to Saturday until
-- now, Friday to Thursday from Friday, 9 October 2026. The week that straddles the change ends the day before it, and the
-- change day opens a period to the first Thursday (PAY run-calc.ts periodEndOf), so no day is paid twice or left out.
INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES
('pay.week_start', '2000-01-01', '"monday"', 'Weekly piece payroll Monday to Saturday (PLAN F2)', '2026-10-09T00:00:00.000+08:00'),
('pay.week_start', '2026-10-09', '"friday"', 'The owner''s decision (Oct 9, 2026): weekly piece payroll Friday to Thursday', '2026-10-09T00:00:00.000+08:00');
