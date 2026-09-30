-- A job order the customer abandoned (PLAN D5 DEP-FORFEIT): the deposit forfeit (COL, DFF-) moves it to 'closed' with
-- this flag set, so the stage history says why it closed and nothing more is released or invoiced on it. Cancelling
-- the forfeit adds the next event back to the stage it came from (flag 0). ADD COLUMN keeps the table and its triggers.
ALTER TABLE jo_stage_events ADD COLUMN abandoned INTEGER NOT NULL DEFAULT 0 CHECK (abandoned IN (0, 1));
