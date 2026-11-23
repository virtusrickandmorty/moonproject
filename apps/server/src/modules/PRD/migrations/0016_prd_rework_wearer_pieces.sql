-- Part of a wearer's pieces sent back for rework (the owner's request, Nov 2026): Send back for rework took all of a
-- ticked wearer's pieces; now the pieces of theirs that need rework may be typed (2 of their 8). NULL (every send-back
-- before this, and a wearer sent back whole): all the wearer's pieces.
ALTER TABLE prd_rework_wearers ADD COLUMN pieces INTEGER CHECK (pieces IS NULL OR pieces >= 1);
