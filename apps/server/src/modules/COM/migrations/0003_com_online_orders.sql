-- Online order emails (the website shop, SHP): placed (with the order's own link), payment confirmed, payment not
-- confirmed, ready. The buyer is not a customer record: the address is the one typed at checkout, where the buyer agreed
-- to it being kept for the order, so `customer_id` and `employee_id` are both empty and `document_number` holds the order
-- number. SQLite cannot change a CHECK in place, so the outbox and its attempt log are rebuilt with every row kept as it was.
DROP TRIGGER com_outbox_content_fixed;
CREATE TABLE com_outbox_new (
  id               TEXT PRIMARY KEY,
  template         TEXT NOT NULL CHECK (template IN ('job_order_created', 'job_order_ready', 'claimed', 'statement', 'payslip', 'online_order')),
  customer_id      TEXT,                                              -- the customer; none for a payslip or an online order
  employee_id      TEXT,                                              -- the employee; only for a payslip
  customer_name    TEXT NOT NULL,                                     -- the recipient's name
  to_address       TEXT NOT NULL CHECK (length(trim(to_address)) > 0), -- from the record (or the online order) when queued
  document_id      TEXT REFERENCES documents(id),                     -- the job order, release slip or payroll release; none for a statement or an online order
  document_number  TEXT,                                              -- for an online order, its number (WEB-…)
  period_from      TEXT,
  period_to        TEXT,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  attachment_name  TEXT,
  attachment_html  TEXT,
  dedupe_key       TEXT UNIQUE,
  status           TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at  TEXT NOT NULL,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  created_by       TEXT REFERENCES users(id),
  sent_at          TEXT,
  CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CHECK ((attachment_name IS NULL) = (attachment_html IS NULL)),
  CHECK ((template = 'payslip') = (employee_id IS NOT NULL)),
  CHECK ((template IN ('payslip', 'online_order')) = (customer_id IS NULL)),
  CHECK (template <> 'payslip' OR (document_id IS NOT NULL AND period_from IS NOT NULL AND period_to IS NOT NULL AND attachment_html IS NOT NULL AND dedupe_key IS NOT NULL)),
  CHECK (template <> 'online_order' OR (document_number IS NOT NULL AND dedupe_key IS NOT NULL))
) STRICT;
INSERT INTO com_outbox_new (id, template, customer_id, employee_id, customer_name, to_address, document_id, document_number, period_from, period_to, subject, body,
    attachment_name, attachment_html, dedupe_key, status, attempts, next_attempt_at, last_error, created_at, created_by, sent_at)
  SELECT id, template, customer_id, employee_id, customer_name, to_address, document_id, document_number, period_from, period_to, subject, body,
    attachment_name, attachment_html, dedupe_key, status, attempts, next_attempt_at, last_error, created_at, created_by, sent_at FROM com_outbox;
CREATE TABLE com_attempts_new (
  id        INTEGER PRIMARY KEY,
  outbox_id TEXT NOT NULL REFERENCES com_outbox_new(id),
  at        TEXT NOT NULL,
  outcome   TEXT NOT NULL CHECK (outcome IN ('sent', 'failed', 'resent')),
  error     TEXT,
  user_id   TEXT REFERENCES users(id)
) STRICT;
INSERT INTO com_attempts_new (id, outbox_id, at, outcome, error, user_id) SELECT id, outbox_id, at, outcome, error, user_id FROM com_attempts;
DROP TABLE com_attempts;
DROP TABLE com_outbox;
ALTER TABLE com_outbox_new RENAME TO com_outbox;
ALTER TABLE com_attempts_new RENAME TO com_attempts;
CREATE INDEX com_attempts_outbox ON com_attempts(outbox_id, id);
CREATE TRIGGER com_attempts_no_update BEFORE UPDATE ON com_attempts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: the email attempt log is append-only'); END;
CREATE INDEX com_outbox_due ON com_outbox(status, next_attempt_at);
CREATE INDEX com_outbox_customer ON com_outbox(customer_id);
CREATE INDEX com_outbox_employee ON com_outbox(employee_id);

-- What was queued never changes; only its progress does, and a sent email stays sent.
CREATE TRIGGER com_outbox_content_fixed BEFORE UPDATE ON com_outbox
WHEN NEW.id IS NOT OLD.id OR NEW.template IS NOT OLD.template OR NEW.customer_id IS NOT OLD.customer_id OR NEW.employee_id IS NOT OLD.employee_id
  OR NEW.customer_name IS NOT OLD.customer_name OR NEW.to_address IS NOT OLD.to_address OR NEW.document_id IS NOT OLD.document_id
  OR NEW.document_number IS NOT OLD.document_number OR NEW.period_from IS NOT OLD.period_from OR NEW.period_to IS NOT OLD.period_to
  OR NEW.subject IS NOT OLD.subject OR NEW.body IS NOT OLD.body OR NEW.attachment_name IS NOT OLD.attachment_name
  OR NEW.attachment_html IS NOT OLD.attachment_html OR NEW.dedupe_key IS NOT OLD.dedupe_key
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
  OR OLD.status = 'sent'
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a queued email keeps its recipient, address, subject and text'); END;
