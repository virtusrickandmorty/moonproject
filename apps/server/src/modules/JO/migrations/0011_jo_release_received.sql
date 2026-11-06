-- Who received a release sent out for delivery (the owner's request, Nov 2026), typed once the signed slip comes back: a recorded
-- release is never changed, so this is a row of its own. Insert-only; the latest row counts, so a wrong name is corrected by a new one.
CREATE TABLE jo_release_received (
  id          INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES jo_releases(document_id),
  received_by TEXT NOT NULL,
  received_on TEXT NOT NULL,
  at          TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX jo_release_received_doc ON jo_release_received(document_id, id);
CREATE TRIGGER jo_release_received_no_update BEFORE UPDATE ON jo_release_received BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: who received a release is a new row'); END;
CREATE TRIGGER jo_release_received_no_delete BEFORE DELETE ON jo_release_received BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: who received a release is kept'); END;
