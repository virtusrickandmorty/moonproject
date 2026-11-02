-- How many of each wearer's pieces a floor scan is for (the owner's request, Nov 2026): the worker picks the wearers and
-- the count done for each; approved, each wearer is a row of their own on the Production Entry. NULL (every scan before
-- this): one wearer, the scan's pieces; several, all their pieces left.
ALTER TABLE prd_floor_claim_wearers ADD COLUMN pieces INTEGER CHECK (pieces IS NULL OR pieces >= 1);
