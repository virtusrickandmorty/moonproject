-- A wearer may go out in parts (the owner's request, Nov 2026: a wearer of 10 pieces, 6 ready now). The pieces of that
-- wearer on this release; NULL on a row recorded before, which took all of that wearer's pieces.
ALTER TABLE jo_release_wearers ADD COLUMN qty INTEGER CHECK (qty IS NULL OR qty >= 1);
