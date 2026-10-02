-- Night differential on overtime (PLAN F1; DOLE Handbook on Workers' Statutory Monetary Benefits): of a day's night
-- minutes, how many were also overtime; those are paid 10% of the overtime hourly rate instead of the day's. Never more
-- than the day's overtime minutes or its night minutes. Rows typed before this column are 0.
ALTER TABLE emp_attendance ADD COLUMN night_ot_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (night_ot_minutes >= 0 AND night_ot_minutes <= ot_minutes AND night_ot_minutes <= night_minutes);
