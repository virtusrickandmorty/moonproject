CREATE TABLE szr_sets (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
  garment_type         TEXT NOT NULL CHECK (length(garment_type) > 0),
  sizes_included       TEXT NOT NULL CHECK (length(sizes_included) > 0),
  status               TEXT NOT NULL CHECK (status IN ('in shop', 'lent', 'lost or damaged', 'inactive')),
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;

CREATE TABLE szr_loans (
  id                   TEXT PRIMARY KEY,
  set_id               TEXT NOT NULL REFERENCES szr_sets(id),
  customer_id          TEXT NOT NULL,
  date_out             TEXT NOT NULL CHECK (date_out GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expected_return_date TEXT NOT NULL CHECK (expected_return_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  returned_date        TEXT CHECK (returned_date IS NULL OR returned_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  condition_on_return  TEXT,
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  CHECK ((returned_date IS NULL AND condition_on_return IS NULL) OR (returned_date IS NOT NULL AND condition_on_return IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX idx_szr_loans_open ON szr_loans(set_id) WHERE returned_date IS NULL;
