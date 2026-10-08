-- A wearer's category on a job order roster (the owner's request, Oct 2026): male or female, for the cut. Optional, so
-- every row recorded before it stays as it was (NULL). ADD COLUMN keeps the table and its triggers.
ALTER TABLE jo_roster ADD COLUMN category TEXT CHECK (category IS NULL OR category IN ('male', 'female'));
