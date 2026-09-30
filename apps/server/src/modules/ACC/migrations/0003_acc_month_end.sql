-- Month-end sign-off (PLAN D8 "Monthly"): the accountant signs a month off with a note. Insert-only: a month can be
-- signed again after a change (the newest row counts), and every earlier sign-off stays. Each row keeps the state of
-- the checklist items it was signed over (one row per item, never a JSON blob). Nothing here posts.
CREATE TABLE acc_month_signoffs (
  id        INTEGER PRIMARY KEY,
  month     TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  signed_at TEXT NOT NULL,
  signed_by TEXT NOT NULL REFERENCES users(id),
  note      TEXT NOT NULL CHECK (length(note) BETWEEN 5 AND 500)
) STRICT;
CREATE INDEX acc_month_signoffs_month ON acc_month_signoffs(month, id);

CREATE TABLE acc_month_signoff_items (
  signoff_id INTEGER NOT NULL REFERENCES acc_month_signoffs(id),
  item_key   TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN ('done','not_done','not_needed')),
  detail     TEXT NOT NULL,
  PRIMARY KEY (signoff_id, item_key)
) STRICT;

CREATE TRIGGER acc_month_signoffs_no_update BEFORE UPDATE ON acc_month_signoffs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a sign-off is never edited; sign the month again instead'); END;
CREATE TRIGGER acc_month_signoff_items_no_update BEFORE UPDATE ON acc_month_signoff_items
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a sign-off is never edited; sign the month again instead'); END;
