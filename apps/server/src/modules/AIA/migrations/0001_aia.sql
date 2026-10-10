-- The website's AI assistant (the owner's request, Oct 2026): a chat on the website and shop that answers from the shop's
-- public information (products, prices, how to order, an order's status) and hands a customer to the Support inbox.
-- Its settings are one row changed with a version and an audit row; the API key is never here (a locked file, settings.ts).

CREATE TABLE aia_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  is_on       INTEGER NOT NULL DEFAULT 0 CHECK (is_on IN (0, 1)),
  greeting    TEXT NOT NULL CHECK (length(greeting) BETWEEN 1 AND 300),
  knowledge   TEXT NOT NULL CHECK (length(knowledge) <= 20000), -- what the owner tells it: hours, lead times, how to order
  version     INTEGER NOT NULL CHECK (version >= 1),
  updated_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id)
) STRICT;

-- A chat: who started it (the sender's address, as support messages keep it) and when. Insert-only.
CREATE TABLE aia_chats (
  id          TEXT PRIMARY KEY,
  started_at  TEXT NOT NULL,
  started_ms  INTEGER NOT NULL,
  ip          TEXT NOT NULL
) STRICT;
CREATE INDEX aia_chats_started ON aia_chats (started_ms);

-- What was said, in order; the assistant's turns keep what they cost (the AI service's tokens). Insert-only.
CREATE TABLE aia_messages (
  chat_id        TEXT NOT NULL REFERENCES aia_chats(id),
  seq            INTEGER NOT NULL CHECK (seq >= 1),
  role           TEXT NOT NULL CHECK (role IN ('customer', 'assistant')),
  text           TEXT NOT NULL,
  at             TEXT NOT NULL,
  at_ms          INTEGER NOT NULL,
  input_tokens   INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens  INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  PRIMARY KEY (chat_id, seq)
) STRICT;
CREATE INDEX aia_messages_at ON aia_messages (at_ms);

-- A chat handed to staff: the support message it became. One per chat. Insert-only.
CREATE TABLE aia_handoffs (
  chat_id         TEXT PRIMARY KEY REFERENCES aia_chats(id),
  sup_message_id  TEXT NOT NULL,
  sup_number      TEXT NOT NULL,
  at              TEXT NOT NULL
) STRICT;

CREATE TRIGGER aia_chats_no_update BEFORE UPDATE ON aia_chats BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a chat is kept as it began'); END;
CREATE TRIGGER aia_messages_no_update BEFORE UPDATE ON aia_messages BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: what was said is kept as said'); END;
CREATE TRIGGER aia_handoffs_no_update BEFORE UPDATE ON aia_handoffs BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a handoff is kept as recorded'); END;
