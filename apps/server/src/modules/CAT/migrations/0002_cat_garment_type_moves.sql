-- A price list item's garment type follows its name (the owner's request, Nov 2026): piece rates, job order lines and cost
-- sheets name the garment type as text, and what is recorded stays as it was, so a rename leaves a row here saying where the
-- old name went. Reads follow it to the new name. Insert-only: the latest row for a from_type wins; a row whose to_type is its
-- from_type says the name stands for itself again (a new item took the old name).
CREATE TABLE cat_garment_type_moves (
  id        INTEGER PRIMARY KEY,
  from_type TEXT NOT NULL COLLATE NOCASE,
  to_type   TEXT NOT NULL COLLATE NOCASE,
  item_id   TEXT NOT NULL REFERENCES cat_items(id),
  at        TEXT NOT NULL,
  user_id   TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX cat_garment_type_moves_from ON cat_garment_type_moves(from_type, id);
CREATE TRIGGER cat_garment_type_moves_no_update BEFORE UPDATE ON cat_garment_type_moves
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a garment type move is a new row'); END;
CREATE TRIGGER cat_garment_type_moves_no_delete BEFORE DELETE ON cat_garment_type_moves
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a garment type move is kept'); END;
