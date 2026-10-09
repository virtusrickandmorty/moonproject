-- Which wearers of a job order line went out on a release slip (the owner's request, Oct 2026): ticked on the release
-- form when the line has a wearer list, and printed on the slip. One row per wearer (the job order's roster row); the
-- line's pieces released are their quantities. Insert-only, like the release line; a cancelled release's wearers are
-- free again (its document is not posted).
CREATE TABLE jo_release_wearers (
  document_id   TEXT NOT NULL REFERENCES jo_releases(document_id),
  line_no       INTEGER NOT NULL CHECK (line_no >= 1),
  roster_row_no INTEGER NOT NULL CHECK (roster_row_no >= 1),
  PRIMARY KEY (document_id, line_no, roster_row_no)
) STRICT;

CREATE TRIGGER jo_release_wearers_no_update BEFORE UPDATE ON jo_release_wearers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a release slip''s wearers are kept as recorded'); END;
