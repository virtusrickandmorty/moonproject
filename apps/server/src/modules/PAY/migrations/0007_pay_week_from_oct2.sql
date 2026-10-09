-- The owner moved the start of Friday-to-Thursday weeks to Friday, 2 October 2026 (Oct 9, 2026; it was 9 October in
-- engine migration 0017): the weekly piece payroll runs Oct 2–8, Oct 9–15 …, and the last Monday week is cut to Sep 28
-- – Oct 1. A setting is never backdated where a recorded payroll already used it, so this version goes in only while no
-- recorded weekly piece run covers a day from 28 September 2026 on (none had been recorded then). The 9 October version
-- stays; repeating the same day changes nothing (PAY run-calc.ts periodRuleOf).
INSERT INTO settings (key, effective_from, value_json, reason, created_at)
SELECT 'pay.week_start', '2026-10-02', '"friday"', 'The owner''s decision (Oct 9, 2026): Friday-to-Thursday weeks from Friday, October 2, 2026', '2026-10-09T15:00:00.000+08:00'
 WHERE NOT EXISTS (
   SELECT 1 FROM pay_runs r JOIN documents d ON d.id = r.document_id
    WHERE r.pay_group = 'WEEKLY_PIECE' AND d.status = 'posted' AND r.period_end >= '2026-09-28');
