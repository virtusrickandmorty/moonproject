-- PRD module tables (prefix prd_), PLAN E7. job_order_id points at a JO document, read only through JO public.ts;
-- employee_id points at EMP (not built yet), read only through PRD/emp.ts.

-- Step catalogue in canonical order (seq). Master data: renamed or switched off, never deleted. QC is off (OWN-24).
CREATE TABLE prd_steps (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  seq        INTEGER NOT NULL UNIQUE,
  pay_basis  TEXT NOT NULL CHECK (pay_basis IN ('piece','daily','piece_or_daily')), -- the default; any step can have piece rates
  is_active  INTEGER NOT NULL CHECK (is_active IN (0,1)),
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO prd_steps (id, code, name, seq, pay_basis, is_active, updated_at) VALUES
  (1, 'LAYOUT',     'Layout / Sampling', 10, 'daily',          1, '2026-09-28T00:00:00.000+08:00'),
  (2, 'PRINTING',   'Printing',          20, 'daily',          1, '2026-09-28T00:00:00.000+08:00'),
  (3, 'HEATPRESS',  'Heatpress',         30, 'daily',          1, '2026-09-28T00:00:00.000+08:00'),
  (4, 'CUTTING',    'Cutting',           40, 'piece_or_daily', 1, '2026-09-28T00:00:00.000+08:00'),
  (5, 'EMBROIDERY', 'Embroidery',        50, 'daily',          1, '2026-09-28T00:00:00.000+08:00'),
  (6, 'SEWING',     'Sewing',            60, 'piece',          1, '2026-09-28T00:00:00.000+08:00'),
  (7, 'QC',         'Quality check',     65, 'daily',          0, '2026-09-28T00:00:00.000+08:00'),
  (8, 'PACKING',    'Packing',           70, 'daily',          1, '2026-09-28T00:00:00.000+08:00');

-- Route templates (seed T1–T6). A JO line picks one, then steps can be removed or added.
CREATE TABLE prd_route_templates (
  id   INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
) STRICT;
CREATE TABLE prd_route_template_steps (
  template_id INTEGER NOT NULL REFERENCES prd_route_templates(id),
  step_id     INTEGER NOT NULL REFERENCES prd_steps(id),
  PRIMARY KEY (template_id, step_id)
) STRICT;
INSERT INTO prd_route_templates (id, code, name) VALUES
  (1, 'T1', 'Cut – Sew – Pack'), (2, 'T2', 'Sublimation, full'), (3, 'T3', 'Embroidered garment'),
  (4, 'T4', 'Embroidered, no layout'), (5, 'T5', 'Embroidery only'), (6, 'T6', 'Print and press only');
INSERT INTO prd_route_template_steps (template_id, step_id) VALUES
  (1, 4), (1, 6), (1, 8),
  (2, 1), (2, 2), (2, 3), (2, 4), (2, 6), (2, 8),
  (3, 1), (3, 4), (3, 5), (3, 6), (3, 8),
  (4, 4), (4, 5), (4, 6), (4, 8),
  (5, 5),
  (6, 1), (6, 2), (6, 3), (6, 8);

-- A JO line's production setup (E4 "route template → steps", garment type and complexity for piece rates). Operational
-- data, changed in place with audit (OWN-21): each change is a new seq with its full step list; the latest one counts.
CREATE TABLE prd_line_setups (
  job_order_id TEXT NOT NULL REFERENCES documents(id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  seq          INTEGER NOT NULL CHECK (seq >= 1),
  template_id  INTEGER REFERENCES prd_route_templates(id),
  garment_type TEXT NOT NULL,
  complexity   TEXT NOT NULL CHECK (complexity IN ('simple','standard','complex')),
  at           TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (job_order_id, line_no, seq)
) STRICT;
CREATE TABLE prd_line_setup_steps (
  job_order_id TEXT NOT NULL,
  line_no      INTEGER NOT NULL,
  seq          INTEGER NOT NULL,
  step_id      INTEGER NOT NULL REFERENCES prd_steps(id),
  PRIMARY KEY (job_order_id, line_no, seq, step_id),
  FOREIGN KEY (job_order_id, line_no, seq) REFERENCES prd_line_setups(job_order_id, line_no, seq)
) STRICT;
CREATE TRIGGER prd_line_setups_follow_on BEFORE INSERT ON prd_line_setups
WHEN NEW.seq <> COALESCE((SELECT MAX(seq) FROM prd_line_setups WHERE job_order_id = NEW.job_order_id AND line_no = NEW.line_no), 0) + 1
BEGIN SELECT RAISE(ABORT, 'PRD_SETUP: a setup change must follow on from the current one'); END;

-- Step status per JO line (E7): pending → in progress (pieces recorded) → completed | not needed; reopen with a reason.
-- Only the closing and reopening are stored; the latest event per step counts.
CREATE TABLE prd_step_events (
  job_order_id TEXT NOT NULL REFERENCES documents(id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  step_id      INTEGER NOT NULL REFERENCES prd_steps(id),
  seq          INTEGER NOT NULL CHECK (seq >= 1),
  action       TEXT NOT NULL CHECK (action IN ('complete','not_needed','reopen')),
  reason       TEXT,
  at           TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (job_order_id, line_no, step_id, seq),
  CHECK (action <> 'reopen' OR reason IS NOT NULL)
) STRICT;

-- Production entry (PE-): workers' pieces for one step of one JO, a non-posting document (PLAN C4, D6).
CREATE TABLE prd_entries (
  document_id     TEXT PRIMARY KEY REFERENCES documents(id),
  job_order_id    TEXT NOT NULL REFERENCES documents(id),
  step_id         INTEGER NOT NULL REFERENCES prd_steps(id),
  over_cap_reason TEXT -- more pieces than came out of the previous step (E7 rule 1)
) STRICT;

-- One row per worker per line (E7 prd_assignments). The rate is a snapshot: from the rate table, typed (an override or
-- a rework rate, with a reason), none (progress only), or the corrected row's own rate.
CREATE TABLE prd_assignments (
  id               TEXT PRIMARY KEY,
  document_id      TEXT NOT NULL REFERENCES prd_entries(document_id),
  row_no           INTEGER NOT NULL CHECK (row_no >= 1),
  job_order_id     TEXT NOT NULL REFERENCES documents(id),
  line_no          INTEGER NOT NULL CHECK (line_no >= 1),
  step_id          INTEGER NOT NULL REFERENCES prd_steps(id),
  employee_id      TEXT NOT NULL,
  employee_name    TEXT NOT NULL, -- as it read when recorded
  work_date        TEXT NOT NULL, -- the server's business date
  kind             TEXT NOT NULL CHECK (kind IN ('work','rework','correction')),
  pieces           INTEGER NOT NULL CHECK (pieces <> 0),
  garment_type     TEXT NOT NULL,
  complexity       TEXT NOT NULL CHECK (complexity IN ('simple','standard','complex')),
  rate_cents       INTEGER NOT NULL CHECK (rate_cents >= 0),
  rate_source      TEXT NOT NULL CHECK (rate_source IN ('table','typed','none','original')),
  rate_reason      TEXT,
  amount_cents     INTEGER NOT NULL,
  correction_of_id TEXT REFERENCES prd_assignments(id), -- a negative correction of a row already paid (D6)
  pay_run_line_id  TEXT, -- set by PAY when a payroll run pays it; cleared when that run is cancelled (F3)
  UNIQUE (document_id, row_no),
  CHECK (amount_cents = pieces * rate_cents),
  CHECK ((kind = 'correction') = (correction_of_id IS NOT NULL) AND (kind = 'correction') = (pieces < 0)),
  CHECK ((rate_source = 'typed') = (rate_reason IS NOT NULL))
) STRICT;
CREATE INDEX prd_assignments_line ON prd_assignments(job_order_id, line_no, step_id);
CREATE INDEX prd_assignments_unpaid ON prd_assignments(employee_id, work_date) WHERE pay_run_line_id IS NULL;
-- Paid once (F3): one payroll run line per assignment row.
CREATE UNIQUE INDEX prd_assignments_paid_once ON prd_assignments(pay_run_line_id) WHERE pay_run_line_id IS NOT NULL;

CREATE TRIGGER prd_steps_fixed BEFORE UPDATE OF id, code, seq ON prd_steps
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a step keeps its code and place in the canonical order'); END;
CREATE TRIGGER prd_route_templates_no_update BEFORE UPDATE ON prd_route_templates
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: route templates are seeded'); END;
CREATE TRIGGER prd_line_setups_no_update BEFORE UPDATE ON prd_line_setups
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a setup change is a new row'); END;
CREATE TRIGGER prd_line_setup_steps_no_update BEFORE UPDATE ON prd_line_setup_steps
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a setup change is a new row'); END;
CREATE TRIGGER prd_step_events_no_update BEFORE UPDATE ON prd_step_events
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: step history is append-only'); END;
CREATE TRIGGER prd_entries_no_update BEFORE UPDATE ON prd_entries
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded production entries are cancelled and reissued, never edited'); END;
-- Only pay_run_line_id may change, and only by PAY.
CREATE TRIGGER prd_assignments_paid_only BEFORE UPDATE OF id, document_id, row_no, job_order_id, line_no, step_id, employee_id, employee_name,
  work_date, kind, pieces, garment_type, complexity, rate_cents, rate_source, rate_reason, amount_cents, correction_of_id ON prd_assignments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: recorded pieces are corrected with a new entry, never edited'); END;
