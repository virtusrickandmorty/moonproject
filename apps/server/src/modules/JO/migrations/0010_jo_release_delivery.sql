-- A release sent out for delivery (the owner's request, Nov 2026): nobody has claimed it yet, so the slip prints with the receiver
-- left blank to sign by hand. claimed_by then holds the words "For delivery" and id_seen is none.
ALTER TABLE jo_releases ADD COLUMN for_delivery INTEGER NOT NULL DEFAULT 0 CHECK (for_delivery IN (0, 1));
