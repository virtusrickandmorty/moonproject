-- Piece-rate table (PLAN E7 RATE): garment type × operation (a PRD step, by code) × complexity → rate per piece, effective-
-- dated. Insert-only: a new rate is a new row from its effective date on, so the history is kept and a production entry's
-- rate snapshot never changes. The latest effective_from on or before the work date wins (the latest row on a tie).
CREATE TABLE rate_piece_rates (
  id             INTEGER PRIMARY KEY,
  garment_type   TEXT NOT NULL COLLATE NOCASE,
  step_code      TEXT NOT NULL,
  complexity     TEXT NOT NULL CHECK (complexity IN ('simple','standard','complex')),
  rate_cents     INTEGER NOT NULL CHECK (rate_cents >= 0),
  effective_from TEXT NOT NULL,
  reason         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES users(id) -- NULL for the starter rows below
) STRICT;
CREATE INDEX rate_piece_rates_key ON rate_piece_rates(garment_type, step_code, complexity, effective_from);

CREATE TRIGGER rate_piece_rates_no_update BEFORE UPDATE ON rate_piece_rates
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a new rate is a new row from its effective date'); END;

-- Starter rates. MADE UP for development and training, shaped like the old piece-pay lines (PLAN E7 examples). The owner
-- confirms or replaces them before the first payroll (OWN-05): a replacement is a new row, effective from its date.
INSERT INTO rate_piece_rates (garment_type, step_code, complexity, rate_cents, effective_from, reason, created_at) VALUES
  ('T-shirt',          'SEWING',  'simple',    3500, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('T-shirt',          'SEWING',  'standard',  4000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('T-shirt',          'SEWING',  'complex',   4500, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('T-shirt',          'CUTTING', 'standard',   800, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Polo shirt',       'SEWING',  'simple',    5500, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Polo shirt',       'SEWING',  'standard',  6000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Polo shirt',       'SEWING',  'complex',   7000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Polo shirt',       'CUTTING', 'standard',  1200, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Shorts',           'SEWING',  'simple',    4000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Shorts',           'SEWING',  'standard',  4500, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Shorts',           'CUTTING', 'standard',   800, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Jersey (NBA cut)', 'SEWING',  'standard',  7000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Jersey (NBA cut)', 'SEWING',  'complex',   7500, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Jersey (NBA cut)', 'CUTTING', 'standard',  1000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Jogging pants',    'SEWING',  'standard',  6500, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Jogging pants',    'CUTTING', 'standard',  1200, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Blouse',           'SEWING',  'standard', 12000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Blouse',           'SEWING',  'complex',  14000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Scrub suit top',   'SEWING',  'standard',  8000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Scrub suit pants', 'SEWING',  'standard',  7000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Jacket',           'SEWING',  'standard', 15000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00'),
  ('Jacket',           'SEWING',  'complex',  18000, '2026-01-01', 'Starter rate (made up), to be confirmed (OWN-05)', '2026-09-28T00:00:00.000+08:00');
