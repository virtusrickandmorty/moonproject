-- Engine tables (no prefix). Modules own tables prefixed with their code, e.g. cash_transfers.
-- Money is INTEGER centavos (*_cents). Dates are TEXT YYYY-MM-DD (Asia/Manila).
-- Timestamps are TEXT ISO-8601 with +08:00. A BEFORE DELETE trigger is added to every table by migrate.ts.

CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  normal_side   TEXT NOT NULL CHECK (normal_side IN ('debit','credit')),
  role_key      TEXT UNIQUE,
  party_type    TEXT CHECK (party_type IN ('customer','supplier','employee','officer','stockholder','loan','asset','free')),
  is_header     INTEGER NOT NULL DEFAULT 0 CHECK (is_header IN (0,1)),
  is_postable   INTEGER NOT NULL DEFAULT 1 CHECK (is_postable IN (0,1)),
  is_cash_place INTEGER NOT NULL DEFAULT 0 CHECK (is_cash_place IN (0,1)),
  is_reserved   INTEGER NOT NULL DEFAULT 0 CHECK (is_reserved IN (0,1)),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order    INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE number_series (
  series_key TEXT PRIMARY KEY,
  prefix     TEXT NOT NULL,
  next_value INTEGER NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  pad        INTEGER NOT NULL DEFAULT 6
) STRICT;
-- Series only move forward by one (gapless, never reset, PLAN D7).
CREATE TRIGGER number_series_forward BEFORE UPDATE ON number_series
WHEN NEW.next_value <> OLD.next_value + 1 OR NEW.prefix IS NOT OLD.prefix OR NEW.series_key IS NOT OLD.series_key
BEGIN SELECT RAISE(ABORT, 'NUMBER_SERIES: numbers only move forward by one'); END;

-- ---------- Security ----------
CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name         TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;

CREATE TABLE permissions (
  key    TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  label  TEXT NOT NULL
) STRICT;

-- Grants are switched on/off, never deleted.
CREATE TABLE role_permissions (
  role_key       TEXT NOT NULL CHECK (role_key IN ('encoder','accountant','owner','production','tv')),
  permission_key TEXT NOT NULL REFERENCES permissions(key),
  granted        INTEGER NOT NULL CHECK (granted IN (0,1)),
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (role_key, permission_key)
) STRICT;

CREATE TABLE user_roles (
  user_id    TEXT NOT NULL REFERENCES users(id),
  role_key   TEXT NOT NULL CHECK (role_key IN ('encoder','accountant','owner','production','tv')),
  active     INTEGER NOT NULL CHECK (active IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role_key)
) STRICT;

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  csrf_token   TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  step_up_at   TEXT
) STRICT;

CREATE TABLE login_attempts (
  id        INTEGER PRIMARY KEY,
  username  TEXT NOT NULL COLLATE NOCASE,
  ip        TEXT NOT NULL,
  at        TEXT NOT NULL,
  at_ms     INTEGER NOT NULL,
  success   INTEGER NOT NULL CHECK (success IN (0,1))
) STRICT;
CREATE INDEX login_attempts_user ON login_attempts(username, at_ms);
CREATE INDEX login_attempts_ip ON login_attempts(ip, at_ms);
CREATE TRIGGER login_attempts_no_update BEFORE UPDATE ON login_attempts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: login attempts are append-only'); END;

-- ---------- Documents ----------
CREATE TABLE documents (
  id              TEXT PRIMARY KEY,
  doc_type        TEXT NOT NULL,
  module          TEXT NOT NULL,
  series_key      TEXT NOT NULL,
  number          TEXT NOT NULL,
  external_number TEXT,
  business_date   TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('posted','cancelled')),
  total_cents     INTEGER NOT NULL,
  summary         TEXT NOT NULL,
  posted_at       TEXT NOT NULL,
  posted_by       TEXT NOT NULL REFERENCES users(id),
  cancelled_at    TEXT,
  cancelled_by    TEXT REFERENCES users(id),
  cancel_reason   TEXT,
  replaces_id     TEXT REFERENCES documents(id),
  replaced_by_id  TEXT REFERENCES documents(id),
  UNIQUE (series_key, number)
) STRICT;
CREATE INDEX documents_type ON documents(doc_type, posted_at);

-- After posting, only the lifecycle fields may change, and only once (PLAN C5, NR-3/NR-4).
CREATE TRIGGER documents_immutable BEFORE UPDATE ON documents
WHEN NEW.id IS NOT OLD.id OR NEW.doc_type IS NOT OLD.doc_type OR NEW.module IS NOT OLD.module
  OR NEW.series_key IS NOT OLD.series_key OR NEW.number IS NOT OLD.number
  OR NEW.external_number IS NOT OLD.external_number OR NEW.business_date IS NOT OLD.business_date
  OR NEW.total_cents IS NOT OLD.total_cents OR NEW.summary IS NOT OLD.summary
  OR NEW.posted_at IS NOT OLD.posted_at OR NEW.posted_by IS NOT OLD.posted_by
  OR NEW.replaces_id IS NOT OLD.replaces_id
  OR (OLD.status = 'cancelled' AND (NEW.status IS NOT OLD.status OR NEW.cancelled_at IS NOT OLD.cancelled_at
      OR NEW.cancelled_by IS NOT OLD.cancelled_by OR NEW.cancel_reason IS NOT OLD.cancel_reason))
  OR (OLD.replaced_by_id IS NOT NULL AND NEW.replaced_by_id IS NOT OLD.replaced_by_id)
  OR (NEW.status = 'cancelled' AND (NEW.cancelled_at IS NULL OR NEW.cancelled_by IS NULL OR length(NEW.cancel_reason) < 10))
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a posted document can only be cancelled'); END;

CREATE TABLE drafts (
  id          TEXT PRIMARY KEY,
  doc_type    TEXT NOT NULL,
  payload     TEXT NOT NULL, -- JSON of the unposted form; drafts are not business records
  version     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL CHECK (status IN ('open','posted','discarded')),
  document_id TEXT REFERENCES documents(id),
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;

-- ---------- Ledger ----------
CREATE TABLE journals (
  id                  TEXT PRIMARY KEY,
  number              TEXT NOT NULL UNIQUE,
  business_date       TEXT NOT NULL,
  source_type         TEXT NOT NULL,
  source_id           TEXT NOT NULL,
  posting_kind        TEXT NOT NULL CHECK (posting_kind IN ('original','reversal')),
  reverses_journal_id TEXT REFERENCES journals(id),
  memo                TEXT NOT NULL,
  sealed              INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0,1)),
  created_at          TEXT NOT NULL,
  created_by          TEXT NOT NULL REFERENCES users(id),
  UNIQUE (source_type, source_id, posting_kind),
  CHECK ((posting_kind = 'reversal') = (reverses_journal_id IS NOT NULL))
) STRICT;

CREATE TABLE journal_lines (
  id            INTEGER PRIMARY KEY,
  journal_id    TEXT NOT NULL REFERENCES journals(id),
  line_no       INTEGER NOT NULL,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  party_type    TEXT,
  party_id      TEXT,
  debit_cents   INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents  INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  memo          TEXT,
  UNIQUE (journal_id, line_no),
  CHECK ((debit_cents > 0) <> (credit_cents > 0)),
  CHECK ((party_type IS NULL) = (party_id IS NULL))
) STRICT;
CREATE INDEX journal_lines_account ON journal_lines(account_id, party_type, party_id);

-- A journal is only ever sealed (0 -> 1); nothing else about it changes.
CREATE TRIGGER journals_immutable BEFORE UPDATE ON journals
WHEN NOT (OLD.sealed = 0 AND NEW.sealed = 1
  AND NEW.id IS OLD.id AND NEW.number IS OLD.number AND NEW.business_date IS OLD.business_date
  AND NEW.source_type IS OLD.source_type AND NEW.source_id IS OLD.source_id
  AND NEW.posting_kind IS OLD.posting_kind AND NEW.reverses_journal_id IS OLD.reverses_journal_id
  AND NEW.memo IS OLD.memo AND NEW.created_at IS OLD.created_at AND NEW.created_by IS OLD.created_by)
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted journals are never changed'); END;

-- Sealing checks the journal balances and has at least two lines (L1).
CREATE TRIGGER journals_seal_balanced BEFORE UPDATE OF sealed ON journals
WHEN NEW.sealed = 1 AND (
  (SELECT COUNT(*) FROM journal_lines WHERE journal_id = NEW.id) < 2
  OR (SELECT SUM(debit_cents) - SUM(credit_cents) FROM journal_lines WHERE journal_id = NEW.id) <> 0)
BEGIN SELECT RAISE(ABORT, 'UNBALANCED: debits must equal credits'); END;

CREATE TRIGGER journal_lines_insert_guard BEFORE INSERT ON journal_lines
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: journal is sealed')
    WHERE (SELECT sealed FROM journals WHERE id = NEW.journal_id) <> 0;
  SELECT RAISE(ABORT, 'BAD_ACCOUNT: header, non-postable or inactive account')
    WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id
                      AND is_header = 0 AND is_postable = 1 AND is_active = 1);
END;

CREATE TRIGGER journal_lines_no_update BEFORE UPDATE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: journal lines are never changed'); END;

-- ---------- Audit ----------
CREATE TABLE audit_log (
  seq         INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  data        TEXT NOT NULL, -- canonical JSON (no personal data beyond names/ids)
  prev_hash   TEXT NOT NULL,
  row_hash    TEXT NOT NULL UNIQUE
) STRICT;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: the audit log is append-only'); END;

-- ---------- Idempotency ----------
CREATE TABLE idempotency_keys (
  key             TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  route           TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body   TEXT NOT NULL,
  created_at      TEXT NOT NULL
) STRICT;
CREATE TRIGGER idempotency_keys_no_update BEFORE UPDATE ON idempotency_keys
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: idempotency records are append-only'); END;
