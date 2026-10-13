-- A wearer's lower size on a set (the owner's request, Oct 2026): a set's top and bottom can be different sizes. The
-- size column is then the upper size. Optional, so rows recorded before it stay valid.
ALTER TABLE jo_roster ADD COLUMN lower_size TEXT CHECK (lower_size IS NULL OR length(lower_size) BETWEEN 1 AND 20);
