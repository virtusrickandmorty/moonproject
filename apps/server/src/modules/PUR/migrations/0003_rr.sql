CREATE TABLE pur_receiving_reports (
  document_id          TEXT PRIMARY KEY REFERENCES documents(id),
  po_document_id       TEXT NOT NULL REFERENCES documents(id)
) STRICT;
CREATE TRIGGER pur_rr_no_update BEFORE UPDATE ON pur_receiving_reports
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted receiving reports are cancelled, never edited'); END;
CREATE TRIGGER pur_rr_no_delete BEFORE DELETE ON pur_receiving_reports
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted receiving reports are cancelled, never deleted'); END;

CREATE TABLE pur_rr_lines (
  id                   TEXT PRIMARY KEY,
  document_id          TEXT NOT NULL REFERENCES documents(id),
  po_line_id           TEXT NOT NULL REFERENCES pur_po_lines(id),
  qty                  INTEGER NOT NULL CHECK (qty > 0)
) STRICT;
CREATE TRIGGER pur_rr_lines_no_delete BEFORE DELETE ON pur_rr_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted receiving report lines are never deleted'); END;
