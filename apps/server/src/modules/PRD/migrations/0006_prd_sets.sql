-- Sets in production (the owner's request, Oct 2026): a line made from a price list set (a jersey set, a uniform) is
-- made as an upper and a lower part. The line's setup says whether it is a set (from the price list item it matched);
-- each production row says which part it is for, and is paid at that part's piece rate. 'whole' is everything before.
ALTER TABLE prd_line_setups ADD COLUMN is_set INTEGER NOT NULL DEFAULT 0 CHECK (is_set IN (0, 1));
ALTER TABLE prd_assignments ADD COLUMN part TEXT NOT NULL DEFAULT 'whole' CHECK (part IN ('whole', 'upper', 'lower'));
