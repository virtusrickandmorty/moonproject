-- One invoice for several releases of the same job order (the owner's request, Nov 2026): when a release slip's invoice is
-- written, the earlier releases of that job order that have no invoice yet can go on it too. Each record's own release stays
-- in jo_invoice_records.release_id; the others it covers are rows here. Insert-only: a record is cancelled and reissued.
CREATE TABLE jo_invoice_record_releases (
  document_id TEXT NOT NULL REFERENCES jo_invoice_records(document_id),
  release_id  TEXT NOT NULL REFERENCES jo_releases(document_id),
  PRIMARY KEY (document_id, release_id)
) STRICT;
CREATE INDEX jo_invoice_record_releases_release ON jo_invoice_record_releases(release_id);
CREATE TRIGGER jo_invoice_record_releases_no_update BEFORE UPDATE ON jo_invoice_record_releases
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded invoice records are cancelled and reissued, never edited'); END;
CREATE TRIGGER jo_invoice_record_releases_no_delete BEFORE DELETE ON jo_invoice_record_releases
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded invoice records are cancelled and reissued, never edited'); END;

-- Every release an invoice record covers: its own and the others. Where "which invoice covers this release" is read.
CREATE VIEW jo_invoice_covers AS
  SELECT document_id, release_id FROM jo_invoice_records
  UNION ALL
  SELECT document_id, release_id FROM jo_invoice_record_releases;
