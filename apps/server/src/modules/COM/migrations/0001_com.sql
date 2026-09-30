-- Customer emails (PLAN E14, C9, OWN-11): the settings, the place the timed scan has reached, and the outbox.
-- The App Password is NOT here: it lives in a file in the data folder that only the service account can read.

CREATE TABLE com_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  sending_on     INTEGER NOT NULL DEFAULT 0 CHECK (sending_on IN (0, 1)),
  smtp_host      TEXT NOT NULL DEFAULT '',
  smtp_port      INTEGER NOT NULL DEFAULT 587 CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_user      TEXT NOT NULL DEFAULT '',
  sender_name    TEXT NOT NULL DEFAULT '',
  sender_address TEXT NOT NULL DEFAULT '',
  version        INTEGER NOT NULL CHECK (version >= 1),
  updated_at     TEXT NOT NULL,
  updated_by     TEXT NOT NULL REFERENCES users(id)
) STRICT;

-- Where each timed scan stopped (a row id of the table it reads), so it carries on from there and reads no posting code.
CREATE TABLE com_cursors (
  key        TEXT PRIMARY KEY CHECK (key IN ('job_order_created', 'job_order_ready', 'release')),
  last_rowid INTEGER NOT NULL CHECK (last_rowid >= 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE com_outbox (
  id               TEXT PRIMARY KEY,
  template         TEXT NOT NULL CHECK (template IN ('job_order_created', 'job_order_ready', 'claimed', 'statement')),
  customer_id      TEXT NOT NULL,
  customer_name    TEXT NOT NULL,
  to_address       TEXT NOT NULL CHECK (length(trim(to_address)) > 0), -- from the customer record when queued
  document_id      TEXT REFERENCES documents(id),                     -- the job order or release slip; none for a statement
  document_number  TEXT,
  period_from      TEXT,                                              -- a statement's dates
  period_to        TEXT,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  attachment_name  TEXT,
  attachment_html  TEXT,
  dedupe_key       TEXT UNIQUE,                                       -- one email per job order or release; none for a statement
  status           TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at  TEXT NOT NULL,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  created_by       TEXT REFERENCES users(id),                         -- the person who queued a statement; none for the timed scan
  sent_at          TEXT,
  CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CHECK ((attachment_name IS NULL) = (attachment_html IS NULL))
) STRICT;
CREATE INDEX com_outbox_due ON com_outbox(status, next_attempt_at);
CREATE INDEX com_outbox_customer ON com_outbox(customer_id);

-- What was queued never changes; only its progress does, and a sent email stays sent.
CREATE TRIGGER com_outbox_content_fixed BEFORE UPDATE ON com_outbox
WHEN NEW.id IS NOT OLD.id OR NEW.template IS NOT OLD.template OR NEW.customer_id IS NOT OLD.customer_id
  OR NEW.customer_name IS NOT OLD.customer_name OR NEW.to_address IS NOT OLD.to_address OR NEW.document_id IS NOT OLD.document_id
  OR NEW.document_number IS NOT OLD.document_number OR NEW.period_from IS NOT OLD.period_from OR NEW.period_to IS NOT OLD.period_to
  OR NEW.subject IS NOT OLD.subject OR NEW.body IS NOT OLD.body OR NEW.attachment_name IS NOT OLD.attachment_name
  OR NEW.attachment_html IS NOT OLD.attachment_html OR NEW.dedupe_key IS NOT OLD.dedupe_key
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
  OR OLD.status = 'sent'
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a queued email keeps its customer, address, subject and text'); END;

-- Every try, sent or failed, and every resend, in order. Nothing here is changed or deleted.
CREATE TABLE com_attempts (
  id        INTEGER PRIMARY KEY,
  outbox_id TEXT NOT NULL REFERENCES com_outbox(id),
  at        TEXT NOT NULL,
  outcome   TEXT NOT NULL CHECK (outcome IN ('sent', 'failed', 'resent')),
  error     TEXT,
  user_id   TEXT REFERENCES users(id)
) STRICT;
CREATE INDEX com_attempts_outbox ON com_attempts(outbox_id, id);
CREATE TRIGGER com_attempts_no_update BEFORE UPDATE ON com_attempts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: the email attempt log is append-only'); END;
