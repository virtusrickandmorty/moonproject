-- Loose-leaf books of accounts (ACC-04): the paper setting and the page counter. Nothing here posts.
CREATE TABLE prt_settings (
  key TEXT PRIMARY KEY CHECK (key IN ('loose_leaf_paper')),
  value TEXT NOT NULL CHECK (value IN ('a4', 'long')),
  updated_at TEXT,
  updated_by TEXT REFERENCES users(id)
) STRICT;
INSERT INTO prt_settings (key, value) VALUES ('loose_leaf_paper', 'a4');

-- One row per print of a book. The last page printed for a book and year is the highest last_page of the prints still in
-- force (a print is replaced when a later print of the same book and year covers its dates).
CREATE TABLE prt_book_prints (
  id INTEGER PRIMARY KEY,
  book TEXT NOT NULL CHECK (book IN ('cash-receipts', 'cash-disbursements', 'sales', 'purchases', 'general-journal', 'general-ledger')),
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL CHECK (to_date >= from_date),
  first_page INTEGER NOT NULL CHECK (first_page >= 1),
  last_page INTEGER NOT NULL CHECK (last_page >= first_page),
  paper TEXT NOT NULL CHECK (paper IN ('a4', 'long')),
  printed_at TEXT NOT NULL,
  printed_by TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX prt_book_prints_book_year ON prt_book_prints (book, year);
CREATE TRIGGER prt_book_prints_no_update BEFORE UPDATE ON prt_book_prints
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: book print log is append-only'); END;
