-- Night differential (PLAN F1, Labor Code Art. 86): the minutes of a day's work between 10 PM and 6 AM, typed beside
-- overtime. At most the 8 hours of that window, and only on a day worked. Rows typed before this column are 0.
ALTER TABLE emp_attendance ADD COLUMN night_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (night_minutes BETWEEN 0 AND 480 AND (night_minutes = 0 OR status IN ('present','half_day','holiday_worked','rest_day_worked')));
