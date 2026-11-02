-- The steps a worker does (the owner's request, Nov 2026): the floor app lists the open job orders with pieces left on
-- them. Insert-only, like emp_floor_users: the latest row of a worker and step counts (is_on 0: not any more).
CREATE TABLE prd_worker_steps (
  seq         INTEGER PRIMARY KEY,
  employee_id TEXT NOT NULL,
  step_id     INTEGER NOT NULL REFERENCES prd_steps(id),
  is_on       INTEGER NOT NULL CHECK (is_on IN (0,1)),
  at          TEXT NOT NULL,
  by_user_id  TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX prd_worker_steps_employee ON prd_worker_steps(employee_id, step_id, seq);
CREATE TRIGGER prd_worker_steps_no_update BEFORE UPDATE ON prd_worker_steps
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a change is a new row'); END;

-- Pieces scanned on the floor app wait for the production head's check (the owner's request, Nov 2026): approved, they
-- are recorded as a Production Entry (entry_id) dated the day of the scan; rejected, nothing is recorded. A claim is
-- decided once: waiting → approved | rejected. checked_pieces: what the head counted, when not what was scanned.
CREATE TABLE prd_floor_claims (
  id             TEXT PRIMARY KEY,
  employee_id    TEXT NOT NULL,
  job_order_id   TEXT NOT NULL REFERENCES documents(id),
  line_no        INTEGER NOT NULL CHECK (line_no >= 1),
  step_id        INTEGER NOT NULL REFERENCES prd_steps(id),
  part           TEXT CHECK (part IN ('upper','lower')),
  pieces         INTEGER NOT NULL CHECK (pieces >= 1),
  again          INTEGER NOT NULL CHECK (again IN (0,1)), -- the worker said it is another batch of the same pieces today
  work_date      TEXT NOT NULL,
  at             TEXT NOT NULL,
  user_id        TEXT NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL CHECK (status IN ('waiting','approved','rejected')),
  checked_pieces INTEGER CHECK (checked_pieces IS NULL OR checked_pieces >= 1),
  reason         TEXT,
  entry_id       TEXT REFERENCES documents(id),
  checked_at     TEXT,
  checked_by     TEXT REFERENCES users(id),
  CHECK ((status = 'waiting') = (checked_at IS NULL)),
  CHECK ((status = 'approved') = (entry_id IS NOT NULL)),
  CHECK (status <> 'rejected' OR reason IS NOT NULL)
) STRICT;
CREATE INDEX prd_floor_claims_waiting ON prd_floor_claims(status, at);
CREATE INDEX prd_floor_claims_employee ON prd_floor_claims(employee_id, at);
CREATE INDEX prd_floor_claims_step ON prd_floor_claims(job_order_id, line_no, step_id) WHERE status = 'waiting';
CREATE TRIGGER prd_floor_claims_decided_once BEFORE UPDATE ON prd_floor_claims
WHEN OLD.status <> 'waiting' OR NEW.id <> OLD.id OR NEW.employee_id <> OLD.employee_id OR NEW.job_order_id <> OLD.job_order_id
  OR NEW.line_no <> OLD.line_no OR NEW.step_id <> OLD.step_id OR NEW.pieces <> OLD.pieces OR NEW.work_date <> OLD.work_date
BEGIN SELECT RAISE(ABORT, 'PRD_CLAIM: a scan is checked once, and what was scanned stays as it was'); END;

-- The wearers the worker ticked on the scan (roster rows of the line).
CREATE TABLE prd_floor_claim_wearers (
  claim_id      TEXT NOT NULL REFERENCES prd_floor_claims(id),
  roster_row_no INTEGER NOT NULL CHECK (roster_row_no >= 1),
  PRIMARY KEY (claim_id, roster_row_no)
) STRICT;
