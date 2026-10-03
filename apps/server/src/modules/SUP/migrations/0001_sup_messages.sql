-- Messages sent from the public support page: inquiries, complaints, suggestions and quotation requests (with pictures).
CREATE TABLE sup_messages (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('inquiry', 'complaint', 'suggestion', 'quotation')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  email TEXT,
  phone TEXT,
  subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
  message TEXT NOT NULL CHECK (length(trim(message)) > 0),
  order_ref TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'closed')),
  ip TEXT NOT NULL,
  received_at TEXT NOT NULL,
  received_ms INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
) STRICT;
CREATE INDEX sup_messages_inbox ON sup_messages(status, received_ms DESC);
CREATE INDEX sup_messages_sender ON sup_messages(ip, received_ms);

-- Pictures kept in the database itself, so every backup carries them with their message.
CREATE TABLE sup_files (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES sup_messages(id),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  sha256 TEXT NOT NULL,
  data BLOB NOT NULL
) STRICT;
CREATE INDEX sup_files_message ON sup_files(message_id);
CREATE TRIGGER sup_files_no_update BEFORE UPDATE ON sup_files
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a received picture is never changed'); END;

-- What staff did with a message: each status change or note, by whom and when.
CREATE TABLE sup_notes (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES sup_messages(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('new', 'in_progress', 'closed')),
  note TEXT NOT NULL,
  at TEXT NOT NULL
) STRICT;
CREATE INDEX sup_notes_message ON sup_notes(message_id, at);
CREATE TRIGGER sup_notes_no_update BEFORE UPDATE ON sup_notes
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: add a new note instead'); END;
