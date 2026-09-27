-- EQ module tables (prefix eq_). The register is master data: edited with If-Match, switched off, never deleted.
-- Document rows are insert-only.

-- Stockholders and officers (PLAN E10). Their id is the party id on 1220/2501 (officer) and 2502/31xx (stockholder).
CREATE TABLE eq_people (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL CHECK (length(trim(name)) >= 2),
  is_stockholder INTEGER NOT NULL CHECK (is_stockholder IN (0,1)),
  is_officer     INTEGER NOT NULL CHECK (is_officer IN (0,1)),
  position       TEXT,                                          -- officer title, e.g. President, Treasurer
  shares         INTEGER CHECK (shares IS NULL OR shares >= 0), -- if known
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version        INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  CHECK (is_stockholder = 1 OR is_officer = 1)
) STRICT;

-- Owner money in (OWN-IN). The classification is required (G-19); capital stock also carries the par part.
CREATE TABLE eq_owner_money (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  person_id       TEXT NOT NULL REFERENCES eq_people(id),
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  classification  TEXT NOT NULL CHECK (classification IN ('advance', 'capital_stock', 'subscription_payment', 'dffs_equity', 'dffs_liability')),
  par_value_cents INTEGER CHECK (par_value_cents IS NULL OR (par_value_cents > 0 AND par_value_cents <= amount_cents)),
  note            TEXT,
  CHECK ((classification = 'capital_stock') = (par_value_cents IS NOT NULL))
) STRICT;
CREATE TRIGGER eq_owner_money_no_update BEFORE UPDATE ON eq_owner_money
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted owner money is cancelled, never edited'); END;

-- Officer money out and back (OFC-OUT, OFC-IN).
CREATE TABLE eq_officer_transactions (
  document_id  TEXT PRIMARY KEY REFERENCES documents(id),
  person_id    TEXT NOT NULL REFERENCES eq_people(id),
  kind         TEXT NOT NULL CHECK (kind IN ('taken', 'returned', 'repaid_to_officer')),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  purpose      TEXT NOT NULL CHECK (length(trim(purpose)) >= 3)
) STRICT;
CREATE INDEX eq_officer_transactions_person ON eq_officer_transactions(person_id, kind);
CREATE TRIGGER eq_officer_transactions_no_update BEFORE UPDATE ON eq_officer_transactions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted officer transactions are cancelled, never edited'); END;
