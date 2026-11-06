-- The time in and time out of a day (the owner's request, Nov 2026), as HH:MM, 24-hour: recorded and shown only. Payroll reads
-- the status and the minutes, never these. A time out earlier than the time in is on the next day. Blank on days from before.
ALTER TABLE emp_attendance ADD COLUMN time_in TEXT CHECK (time_in IS NULL OR time_in GLOB '[0-2][0-9]:[0-5][0-9]');
ALTER TABLE emp_attendance ADD COLUMN time_out TEXT CHECK (time_out IS NULL OR time_out GLOB '[0-2][0-9]:[0-5][0-9]');
