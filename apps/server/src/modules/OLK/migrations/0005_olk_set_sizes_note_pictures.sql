-- A set (an upper and a lower part on the price list) may be one size on top and another below (the owner's request, Nov
-- 2026): the lower part's size when it differs; empty means the same as the top.
ALTER TABLE olk_pieces ADD COLUMN lower_size TEXT;

-- A note for the customer at the top of the link, and pictures of the design (the owner's request, Nov 2026). Staff change
-- them any time; a picture taken off stays here with who took it off and when.
ALTER TABLE olk_links ADD COLUMN note TEXT;
CREATE TABLE olk_link_pictures (
  id           TEXT PRIMARY KEY,
  link_id      TEXT NOT NULL REFERENCES olk_links(id),
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  data         BLOB NOT NULL,
  added_at     TEXT NOT NULL,
  added_by     TEXT NOT NULL REFERENCES users(id),
  removed_at   TEXT,
  removed_by   TEXT REFERENCES users(id)
) STRICT;
CREATE INDEX olk_link_pictures_link ON olk_link_pictures(link_id, added_at);
