-- Customer ratings (the owner's request, Nov 2026): after a job order is released, the customer rates it from 1 to 5 stars
-- on a private link (emailed, or sent by staff on Messenger). A low rating tells staff to call the customer.

CREATE TABLE fbk_requests (
  id            TEXT PRIMARY KEY,
  job_order_id  TEXT NOT NULL REFERENCES documents(id),
  job_order_no  TEXT NOT NULL UNIQUE,                                   -- one request per job order
  customer_id   TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE CHECK (length(token) BETWEEN 20 AND 64), -- the link's private part
  created_at    TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id)                               -- none when made by the daily check
) STRICT;

-- The customer's rating: once per request. Insert-only.
CREATE TABLE fbk_ratings (
  request_id  TEXT PRIMARY KEY REFERENCES fbk_requests(id),
  stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     TEXT CHECK (comment IS NULL OR length(comment) <= 2000),
  name        TEXT CHECK (name IS NULL OR length(name) <= 120),
  at          TEXT NOT NULL
) STRICT;
CREATE INDEX fbk_ratings_at ON fbk_ratings(at);

CREATE TRIGGER fbk_requests_no_update BEFORE UPDATE ON fbk_requests BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a rating request stays as made'); END;
CREATE TRIGGER fbk_requests_no_delete BEFORE DELETE ON fbk_requests BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a rating request is kept'); END;
CREATE TRIGGER fbk_ratings_no_update BEFORE UPDATE ON fbk_ratings BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a rating stays as given'); END;
CREATE TRIGGER fbk_ratings_no_delete BEFORE DELETE ON fbk_ratings BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a rating is kept'); END;
