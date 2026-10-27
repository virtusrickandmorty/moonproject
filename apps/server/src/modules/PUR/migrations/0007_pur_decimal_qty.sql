-- migrate: rebuild-with-foreign-keys-off
-- Quantities with decimals on purchase requests, purchase orders and receiving reports (the owner's request, Oct 27,
-- 2026): 12.5 yards of fabric, 2.75 kg of thread. Kept exact as hundredths of a unit in whole numbers (12.5 yards is
-- 1250), as the customers' measurements are; up to 1,000,000 units. Every row is copied with its quantity × 100, the
-- tables that point to these keep pointing to the copies, and the migration runner checks every link before keeping it.
CREATE TABLE pur_po_lines_next (
  document_id          TEXT NOT NULL REFERENCES documents(id),
  line_no              INTEGER NOT NULL CHECK (line_no > 0),
  supply_id            TEXT NOT NULL REFERENCES pur_supplies(id),
  qty_hundredths       INTEGER NOT NULL CHECK (qty_hundredths > 0 AND qty_hundredths <= 100000000),
  unit_cost_cents      INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  PRIMARY KEY (document_id, line_no)
) STRICT;
INSERT INTO pur_po_lines_next (document_id, line_no, supply_id, qty_hundredths, unit_cost_cents)
  SELECT document_id, line_no, supply_id, qty * 100, unit_cost_cents FROM pur_po_lines;
DROP TABLE pur_po_lines;
ALTER TABLE pur_po_lines_next RENAME TO pur_po_lines;
CREATE TRIGGER pur_po_lines_no_update BEFORE UPDATE ON pur_po_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted purchase order lines are cancelled, never edited'); END;

CREATE TABLE pur_rr_lines_next (
  document_id          TEXT NOT NULL REFERENCES documents(id),
  line_no              INTEGER NOT NULL CHECK (line_no > 0),
  po_document_id       TEXT NOT NULL,
  po_line_no           INTEGER NOT NULL,
  qty_hundredths       INTEGER NOT NULL CHECK (qty_hundredths > 0 AND qty_hundredths <= 100000000),
  PRIMARY KEY (document_id, line_no),
  FOREIGN KEY (po_document_id, po_line_no) REFERENCES pur_po_lines(document_id, line_no)
) STRICT;
INSERT INTO pur_rr_lines_next (document_id, line_no, po_document_id, po_line_no, qty_hundredths)
  SELECT document_id, line_no, po_document_id, po_line_no, qty * 100 FROM pur_rr_lines;
DROP TABLE pur_rr_lines;
ALTER TABLE pur_rr_lines_next RENAME TO pur_rr_lines;
CREATE TRIGGER pur_rr_lines_no_update BEFORE UPDATE ON pur_rr_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted receiving report lines are cancelled, never edited'); END;

CREATE TABLE pur_request_lines_next (
  document_id     TEXT NOT NULL REFERENCES pur_requests(document_id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  supply_id       TEXT REFERENCES pur_supplies(id), -- a supply on file, or NULL for something described only
  description     TEXT NOT NULL CHECK (length(trim(description)) >= 2),
  qty_hundredths  INTEGER NOT NULL CHECK (qty_hundredths > 0 AND qty_hundredths <= 100000000),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0), -- the requester's estimate
  PRIMARY KEY (document_id, line_no)
) STRICT;
INSERT INTO pur_request_lines_next (document_id, line_no, supply_id, description, qty_hundredths, unit_cost_cents)
  SELECT document_id, line_no, supply_id, description, qty * 100, unit_cost_cents FROM pur_request_lines;
DROP TABLE pur_request_lines;
ALTER TABLE pur_request_lines_next RENAME TO pur_request_lines;
CREATE TRIGGER pur_request_lines_no_update BEFORE UPDATE ON pur_request_lines BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a recorded request is edited by cancel and reissue'); END;
