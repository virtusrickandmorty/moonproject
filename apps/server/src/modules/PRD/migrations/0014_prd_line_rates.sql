-- A piece rate set for one job order line (the owner's request, Nov 2026): an alteration is paid what management set when
-- accepting it, not the garment's full rate, because the piece is only altered. The latest row of a line and step stands;
-- a change is a new row, so what was set before is kept. A production entry takes the rate as a snapshot, as ever.
CREATE TABLE prd_line_rates (
  id           INTEGER PRIMARY KEY,
  job_order_id TEXT NOT NULL REFERENCES documents(id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  step_code    TEXT NOT NULL,
  rate_cents   INTEGER NOT NULL CHECK (rate_cents >= 0),
  reason       TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  at           TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX prd_line_rates_line ON prd_line_rates(job_order_id, line_no, step_code);
CREATE TRIGGER prd_line_rates_no_update BEFORE UPDATE ON prd_line_rates
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a line rate is changed by a new row'); END;
