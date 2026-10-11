-- Switching a garment type's piece rates off (the owner's request, Oct 2026): the rates of a garment type no price list
-- item goes by, and no job order item is made as, can be switched off; they then apply to no new piece (recorded pieces
-- keep the rate they took). The latest row for a garment type wins; switching it on again is a new row. Insert-only.
CREATE TABLE rate_garment_type_switches (
  id           INTEGER PRIMARY KEY,
  garment_type TEXT NOT NULL COLLATE NOCASE,
  is_on        INTEGER NOT NULL CHECK (is_on IN (0, 1)),
  reason       TEXT NOT NULL CHECK (length(reason) >= 10),
  at           TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX rate_garment_type_switches_type ON rate_garment_type_switches(garment_type, id);
CREATE TRIGGER rate_garment_type_switches_no_update BEFORE UPDATE ON rate_garment_type_switches
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: switching a garment type on or off is a new row'); END;
