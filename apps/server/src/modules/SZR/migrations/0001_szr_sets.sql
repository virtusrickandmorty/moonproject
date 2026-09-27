CREATE TABLE szr_sets (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  garment_type         TEXT NOT NULL,
  sizes_included       TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('in shop', 'lent', 'lost or damaged', 'inactive')),
  version              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;

CREATE TABLE szr_loans (
  id                   TEXT PRIMARY KEY,
  set_id               TEXT NOT NULL REFERENCES szr_sets(id),
  customer_id          TEXT NOT NULL,
  date_out             TEXT NOT NULL,
  expected_return_date TEXT NOT NULL,
  returned_date        TEXT,
  condition_on_return  TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;
