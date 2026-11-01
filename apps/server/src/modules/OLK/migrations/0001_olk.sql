-- Order links (the owner's request, Nov 2026): a private link staff make and send to a customer, who fills in the order
-- details there before any job order exists: a team list (one person fills every player) or a group order (each member
-- fills their own pieces). Staff review what comes in and make the job orders from it (a later step).

CREATE TABLE olk_links (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE CHECK (length(token) BETWEEN 20 AND 64), -- the link's private part (staff copy it again)
  kind        TEXT NOT NULL CHECK (kind IN ('team', 'group')),
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  customer_id TEXT REFERENCES cus_customers(id),                              -- optional: else made from their details
  closes_on   TEXT NOT NULL,                                                  -- open through this Manila date
  pay_own     INTEGER NOT NULL DEFAULT 0 CHECK (pay_own IN (0, 1)),           -- a group order whose members pay their own share
  closed_at   TEXT,                                                           -- closed early by staff
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  updated_at  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1
) STRICT;

-- The price list items a link is for, and how each is sized: standard sizes, or made to measure with these measurements.
CREATE TABLE olk_link_items (
  link_id   TEXT NOT NULL REFERENCES olk_links(id),
  line_no   INTEGER NOT NULL CHECK (line_no BETWEEN 1 AND 20),
  item_id   TEXT NOT NULL,
  item_name TEXT NOT NULL,
  sizing    TEXT NOT NULL CHECK (sizing IN ('size', 'measure')),
  PRIMARY KEY (link_id, line_no)
) STRICT;
CREATE TABLE olk_item_fields (
  link_id TEXT NOT NULL REFERENCES olk_links(id),
  line_no INTEGER NOT NULL,
  field   TEXT NOT NULL CHECK (field IN ('shoulder','chest','upperWaist','collar','bustPoint','figurePoint','bustDistance','armHole','sleeveHole',
            'sleeveLength','upperLength','lowerWaist','hips','crotch','thigh','calf','ankle','lowerLength')),
  PRIMARY KEY (link_id, line_no, field)
) STRICT;

-- One answer: the person who filled it (the coach, or a member), with the details every answer must give.
CREATE TABLE olk_responses (
  id          TEXT PRIMARY KEY,
  link_id     TEXT NOT NULL REFERENCES olk_links(id),
  edit_hash   TEXT NOT NULL UNIQUE,                 -- their own key to change it until the link closes (only its hash kept)
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  gender      TEXT NOT NULL CHECK (gender IN ('female', 'male')),
  mobile      TEXT NOT NULL CHECK (length(mobile) BETWEEN 7 AND 20),
  email       TEXT NOT NULL CHECK (length(email) BETWEEN 5 AND 200),
  address     TEXT NOT NULL CHECK (length(address) BETWEEN 5 AND 300),
  ip          TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE INDEX olk_responses_link ON olk_responses(link_id, created_at);

-- An answer's people, pieces and measurements, by version: a change saves the whole answer again as the next version (nothing
-- is deleted); the answer's own version says which is in force.

-- The people an answer is for: the member themself (row 0) on a group order; each player (rows 1…) on a team list.
CREATE TABLE olk_people (
  response_id TEXT NOT NULL REFERENCES olk_responses(id),
  version     INTEGER NOT NULL,
  row_no      INTEGER NOT NULL CHECK (row_no BETWEEN 0 AND 500),
  name        TEXT,                                -- a player's full name (optional)
  back_name   TEXT,                                -- the name on the back
  number      TEXT,
  gender      TEXT NOT NULL CHECK (gender IN ('female', 'male')),
  measure_at_shop INTEGER NOT NULL DEFAULT 0 CHECK (measure_at_shop IN (0, 1)),
  PRIMARY KEY (response_id, version, row_no)
) STRICT;

-- Each person's pieces: how many of each item, and the size (standard sizing).
CREATE TABLE olk_pieces (
  response_id TEXT NOT NULL REFERENCES olk_responses(id),
  version     INTEGER NOT NULL,
  row_no      INTEGER NOT NULL,
  line_no     INTEGER NOT NULL,
  qty         INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 100),
  size        TEXT,
  PRIMARY KEY (response_id, version, row_no, line_no)
) STRICT;

-- Measurements in hundredths of an inch: the person's own (line_no 0), and a different value for one item (its line_no),
-- since some items vary in length or width.
CREATE TABLE olk_measures (
  response_id TEXT NOT NULL REFERENCES olk_responses(id),
  version     INTEGER NOT NULL,
  row_no      INTEGER NOT NULL,
  line_no     INTEGER NOT NULL,
  field       TEXT NOT NULL,
  hundredths  INTEGER NOT NULL CHECK (hundredths BETWEEN 1 AND 30000),
  PRIMARY KEY (response_id, version, row_no, line_no, field)
) STRICT;
