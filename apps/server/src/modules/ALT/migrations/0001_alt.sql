-- Alterations and replacements (the owner's request, Oct 2026): items a customer brings back to be altered or replaced.
-- Staff receive them (ALT-); the owner or the accountant decides, line by line, free or a fee per piece (or declines the
-- return); then a job order for the customer at that fee goes on the production board, and the items go back on a
-- release slip like any job order (its invoice record when there is a fee). Insert-only: what happened is never edited.

CREATE TABLE alt_sequences (key TEXT PRIMARY KEY, next_value INTEGER NOT NULL CHECK (next_value >= 1)) STRICT;
INSERT INTO alt_sequences VALUES ('return', 1);

CREATE TABLE alt_returns (
  id            TEXT PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  customer_id   TEXT NOT NULL REFERENCES cus_customers(id),
  received_on   TEXT NOT NULL,                       -- the business day the items came in (Manila)
  contact       TEXT,
  notes         TEXT,
  at            TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id)
) STRICT;

-- What came back: from a released job order line, a quick sale line (POS or online order), or described by hand.
CREATE TABLE alt_return_lines (
  return_id       TEXT NOT NULL REFERENCES alt_returns(id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  action          TEXT NOT NULL CHECK (action IN ('alteration', 'replacement')),
  source          TEXT NOT NULL CHECK (source IN ('job_order', 'sale', 'other')),
  source_doc_id   TEXT REFERENCES documents(id),
  source_line_no  INTEGER,
  description     TEXT NOT NULL CHECK (length(trim(description)) > 0),
  qty             INTEGER NOT NULL CHECK (qty >= 1),
  problem         TEXT NOT NULL CHECK (length(trim(problem)) >= 3),
  -- A replacement's returned piece: kept, scrapped, used for parts, or (a website item) fixed and sold again (Shop work).
  old_piece       TEXT CHECK (old_piece IN ('kept', 'scrapped', 'parts', 'shop_rework')),
  old_piece_note  TEXT,
  product_id      TEXT,                              -- the website item, when it came from a website or POS sale
  size            TEXT,
  colour          TEXT,
  PRIMARY KEY (return_id, line_no),
  CHECK ((source = 'other') = (source_doc_id IS NULL)),
  CHECK ((action = 'replacement') = (old_piece IS NOT NULL))
) STRICT;

-- Management's decision (alt.decide): accepted with a fee per piece for each line (0 = free), or declined. Once only.
CREATE TABLE alt_decisions (
  return_id     TEXT PRIMARY KEY REFERENCES alt_returns(id),
  outcome       TEXT NOT NULL CHECK (outcome IN ('accepted', 'declined')),
  reason        TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  job_order_id  TEXT REFERENCES documents(id),        -- the job order made when accepted
  shop_work_id  TEXT REFERENCES documents(id),        -- returned website pieces sent to Shop work, if any
  at            TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id),
  CHECK ((outcome = 'accepted') = (job_order_id IS NOT NULL))
) STRICT;
CREATE TABLE alt_decision_lines (
  return_id        TEXT NOT NULL REFERENCES alt_decisions(return_id),
  line_no          INTEGER NOT NULL CHECK (line_no >= 1),
  fee_each_cents   INTEGER NOT NULL CHECK (fee_each_cents >= 0),
  PRIMARY KEY (return_id, line_no)
) STRICT;

CREATE INDEX alt_returns_customer ON alt_returns (customer_id);
CREATE INDEX alt_decisions_job ON alt_decisions (job_order_id);

CREATE TRIGGER alt_returns_no_update BEFORE UPDATE ON alt_returns BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: returns are kept as received'); END;
CREATE TRIGGER alt_returns_no_delete BEFORE DELETE ON alt_returns BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: returns are kept as received'); END;
CREATE TRIGGER alt_return_lines_no_update BEFORE UPDATE ON alt_return_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: returns are kept as received'); END;
CREATE TRIGGER alt_return_lines_no_delete BEFORE DELETE ON alt_return_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: returns are kept as received'); END;
CREATE TRIGGER alt_decisions_no_update BEFORE UPDATE ON alt_decisions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a decision is kept as made'); END;
CREATE TRIGGER alt_decisions_no_delete BEFORE DELETE ON alt_decisions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a decision is kept as made'); END;
CREATE TRIGGER alt_decision_lines_no_update BEFORE UPDATE ON alt_decision_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a decision is kept as made'); END;
CREATE TRIGGER alt_decision_lines_no_delete BEFORE DELETE ON alt_decision_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a decision is kept as made'); END;
