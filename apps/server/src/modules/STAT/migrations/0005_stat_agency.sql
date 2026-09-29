-- W24: agency upload files and the exposure report (PLAN E11, ACC-05). Two small STAT tables, both append-only.
--
-- The employer's number at each agency. The company profile (PRT) holds the TIN only, and PRT is not STAT's lane, so the
-- SSS employer number, the PhilHealth employer number (PEN) and the Pag-IBIG employer ID are kept here. The newest row of
-- a scheme is the one in force; an older row stays as the history of what an earlier upload file carried.
CREATE TABLE stat_employer_numbers (
  id         INTEGER PRIMARY KEY,
  scheme     TEXT NOT NULL CHECK (scheme IN ('SSS', 'PHIC', 'HDMF')),
  number     TEXT NOT NULL CHECK (length(number) BETWEEN 1 AND 40),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX stat_employer_numbers_scheme ON stat_employer_numbers(scheme, id);
CREATE TRIGGER stat_employer_numbers_no_update BEFORE UPDATE ON stat_employer_numbers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a new employer number is a new row'); END;

-- What an agency charges on contributions paid late, per month late, in basis points (200 = 2% a month), by the date it
-- takes effect. The exposure report estimates with the rate in force on the day it is run; a new rate is a new row. These
-- are the accountant's to confirm (ACC-05): the seeds are the statutes' rates, not read off an agency notice.
CREATE TABLE stat_penalty_rates (
  id             INTEGER PRIMARY KEY,
  scheme         TEXT NOT NULL CHECK (scheme IN ('SSS', 'PHIC', 'HDMF')),
  effective_from TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  monthly_bp     INTEGER NOT NULL CHECK (monthly_bp BETWEEN 0 AND 10000),
  source         TEXT NOT NULL,
  created_at     TEXT NOT NULL
) STRICT;
CREATE TRIGGER stat_penalty_rates_no_update BEFORE UPDATE ON stat_penalty_rates
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a new rate is a new row from its date'); END;

INSERT INTO stat_penalty_rates (scheme, effective_from, monthly_bp, source, created_at) VALUES
  ('SSS',  '2019-01-01', 200, 'RA 11199 sec. 22: 2% a month on the unpaid contribution (accountant to confirm)', '2026-09-29T00:00:00.000+08:00'),
  ('PHIC', '2019-01-01', 200, 'RA 11223 / PhilHealth rules: 2% a month interest; a waiver is open until 31 Dec 2026 (ACC-05, accountant to confirm)', '2026-09-29T00:00:00.000+08:00'),
  ('HDMF', '2019-01-01',  90, 'Pag-IBIG: 3/100 of 1% a day of delay, taken as 30 days a month (accountant to confirm)', '2026-09-29T00:00:00.000+08:00');
