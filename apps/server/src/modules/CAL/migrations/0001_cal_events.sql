-- Calendar events are snapshots. A move or cancellation inserts the next version; old rows stay readable.
CREATE TABLE cal_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  action TEXT NOT NULL CHECK (action IN ('create', 'move', 'cancel')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  event_date TEXT NOT NULL,
  event_time TEXT,
  customer_id TEXT,
  job_order_id TEXT,
  notes TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE (event_id, seq),
  CHECK ((action = 'cancel') = (reason IS NOT NULL))
) STRICT;
CREATE INDEX cal_events_date ON cal_events(event_date);
CREATE TRIGGER cal_events_no_update BEFORE UPDATE ON cal_events
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a calendar change is a new row'); END;
CREATE TRIGGER cal_events_next BEFORE INSERT ON cal_events
WHEN NEW.seq <> COALESCE((SELECT MAX(seq) FROM cal_events WHERE event_id = NEW.event_id), 0) + 1
BEGIN SELECT RAISE(ABORT, 'CAL_EVENT: a change must follow the current version'); END;
