-- Purchase requests (PRQ-, the owner's request, 26 Oct 2026): staff ask for supplies or a purchase before it is ordered.
-- The owner or the accountant approves or rejects each one, once. An approved request goes on to a purchase order or an
-- expense voucher (one of them, once): the order or voucher names it (request_id). Staff without pur.po.without_request
-- make a purchase order only from an approved request.
CREATE TABLE pur_requests (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  purpose     TEXT NOT NULL CHECK (length(trim(purpose)) >= 5),
  needed_by   TEXT,
  supplier_id TEXT REFERENCES pur_suppliers(id), -- a preferred supplier, or NULL
  note        TEXT
) STRICT;
CREATE TABLE pur_request_lines (
  document_id     TEXT NOT NULL REFERENCES pur_requests(document_id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  supply_id       TEXT REFERENCES pur_supplies(id), -- a supply on file, or NULL for something described only
  description     TEXT NOT NULL CHECK (length(trim(description)) >= 2),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0), -- the requester's estimate
  PRIMARY KEY (document_id, line_no)
) STRICT;
-- One decision per request, never changed: a rejected request is edited (cancel and reissue) and decided again.
CREATE TABLE pur_request_decisions (
  request_id TEXT PRIMARY KEY REFERENCES pur_requests(document_id),
  decision   TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note       TEXT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  at         TEXT NOT NULL
) STRICT;
CREATE TRIGGER pur_requests_no_update BEFORE UPDATE ON pur_requests BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded request is edited by cancel and reissue'); END;
CREATE TRIGGER pur_request_lines_no_update BEFORE UPDATE ON pur_request_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded request is edited by cancel and reissue'); END;
CREATE TRIGGER pur_request_decisions_no_update BEFORE UPDATE ON pur_request_decisions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a decision is made once'); END;
CREATE TRIGGER pur_request_decisions_no_delete BEFORE DELETE ON pur_request_decisions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a decision is made once'); END;

ALTER TABLE pur_purchase_orders ADD COLUMN request_id TEXT REFERENCES pur_requests(document_id);
