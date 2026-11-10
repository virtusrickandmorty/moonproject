-- Custom fit (the owner's request, Nov 2026): an item in standard sizes may also let a person choose "Custom fit" and give
-- their own measurements instead of a size. The link's item says whether it may (with the measurements it then needs, kept
-- in olk_item_fields like a made-to-measure item's), and each piece says whether it was chosen.
ALTER TABLE olk_link_items ADD COLUMN custom_fit INTEGER NOT NULL DEFAULT 0 CHECK (custom_fit IN (0, 1));
ALTER TABLE olk_pieces ADD COLUMN custom_fit INTEGER NOT NULL DEFAULT 0 CHECK (custom_fit IN (0, 1));
