-- Job orders from an order link (the owner's request, Nov 2026): each time staff start a job order from answers, and the
-- customer's wearers made from them, so a second start (a member who filled in late, a changed answer) reuses them.

-- Each start: which answer (at which version), for which customer, and whether it went with other answers (one job order
-- for the team or group) or alone (a member's own job order).
CREATE TABLE olk_made (
  id          TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES olk_responses(id),
  made_at     TEXT NOT NULL,
  version     INTEGER NOT NULL,                       -- the answer's version used
  customer_id TEXT NOT NULL REFERENCES cus_customers(id),
  together    INTEGER NOT NULL CHECK (together IN (0, 1)),
  made_by     TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX olk_made_response ON olk_made(response_id, made_at);

-- The wearer made for a person of an answer, under a customer, and the answer version their measurement chart is from.
CREATE TABLE olk_wearers (
  response_id   TEXT NOT NULL REFERENCES olk_responses(id),
  row_no        INTEGER NOT NULL,
  customer_id   TEXT NOT NULL REFERENCES cus_customers(id),
  person_id     TEXT NOT NULL REFERENCES cus_people(id),
  chart_version INTEGER,                              -- null: no chart from the link yet (measured at the shop)
  PRIMARY KEY (response_id, row_no, customer_id)
) STRICT;
