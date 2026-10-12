-- Whose pieces came back (the owner's request, Oct 2026): on a job order line with wearers, the wearers picked on the
-- return, as they were on the job order (name, size, jersey, pieces). The alteration job order carries them, so
-- production sees whose pieces to work on. Insert-only.
CREATE TABLE alt_return_wearers (
  return_id      TEXT NOT NULL REFERENCES alt_returns(id),
  line_no        INTEGER NOT NULL CHECK (line_no >= 1),
  roster_row_no  INTEGER NOT NULL CHECK (roster_row_no >= 1),
  person_id      TEXT,
  wearer_name    TEXT NOT NULL,
  size_mode      TEXT NOT NULL CHECK (size_mode IN ('preset', 'measured')),
  size           TEXT,
  jersey_name    TEXT,
  jersey_number  TEXT,
  qty            INTEGER NOT NULL CHECK (qty >= 1),
  PRIMARY KEY (return_id, line_no, roster_row_no)
) STRICT;
CREATE TRIGGER alt_return_wearers_no_update BEFORE UPDATE ON alt_return_wearers BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: returns are kept as received'); END;
CREATE TRIGGER alt_return_wearers_no_delete BEFORE DELETE ON alt_return_wearers BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: returns are kept as received'); END;
