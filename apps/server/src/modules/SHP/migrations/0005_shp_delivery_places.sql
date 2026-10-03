-- Delivery fee from the address: each delivery area lists the places it covers (cities, municipalities, provinces), and at
-- most one area takes every other address. At checkout the buyer types the city and province; the shop finds the area and
-- its fee (the browser shows it, the server works it out again). Saved with the payment settings, like the areas.
CREATE TABLE shp_delivery_places (
  version INTEGER NOT NULL,
  position INTEGER NOT NULL,       -- the area (shp_delivery_options.position) in that version
  place TEXT NOT NULL CHECK (length(trim(place)) > 0),
  PRIMARY KEY (version, position, place),
  FOREIGN KEY (version, position) REFERENCES shp_delivery_options(version, position)
) STRICT;
CREATE TRIGGER shp_delivery_places_no_update BEFORE UPDATE ON shp_delivery_places BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: save new payment settings'); END;

-- The area that takes every address no other area lists (1 on at most one area of a version).
ALTER TABLE shp_delivery_options ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1));
