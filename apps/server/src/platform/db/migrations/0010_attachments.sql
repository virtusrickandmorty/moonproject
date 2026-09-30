-- Attachments on documents (PLAN C1, C3 engine/attachments.ts): design mock-ups on a quotation, the 2307 received on a
-- collection, a receipt photo on an expense. The file itself lives in the attachments folder beside the database, named
-- by its SHA-256, so the same file added twice is stored once. An attachment is evidence: it never changes a journal.
-- A row is never deleted; removing one records who, when and why, once, and the file stays.
CREATE TABLE attachments (
  id             TEXT PRIMARY KEY,
  document_id    TEXT NOT NULL REFERENCES documents(id),
  file_name      TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  content_type   TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  bytes          INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 10485760),
  sha256         TEXT NOT NULL CHECK (length(sha256) = 64),
  added_by       TEXT NOT NULL REFERENCES users(id),
  added_at       TEXT NOT NULL,
  removed_by     TEXT REFERENCES users(id),
  removed_at     TEXT,
  removed_reason TEXT,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (removed_reason IS NULL))
) STRICT;
CREATE INDEX attachments_document ON attachments(document_id, added_at);
CREATE INDEX attachments_sha256 ON attachments(sha256);

-- Only the removal may be written, and only once.
CREATE TRIGGER attachments_remove_once BEFORE UPDATE ON attachments
WHEN OLD.removed_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.document_id IS NOT OLD.document_id
  OR NEW.file_name IS NOT OLD.file_name OR NEW.content_type IS NOT OLD.content_type OR NEW.bytes IS NOT OLD.bytes
  OR NEW.sha256 IS NOT OLD.sha256 OR NEW.added_by IS NOT OLD.added_by OR NEW.added_at IS NOT OLD.added_at
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an attachment row only records its removal, once'); END;
