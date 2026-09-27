CREATE TABLE pur_receiving_reports (
  document_id          TEXT PRIMARY KEY REFERENCES documents(id),
  po_document_id       TEXT NOT NULL REFERENCES documents(id)
) STRICT;

CREATE TRIGGER pur_rr_no_update BEFORE UPDATE ON pur_receiving_reports
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted receiving reports are cancelled, never edited'); END;

CREATE TABLE pur_rr_lines (
  document_id          TEXT NOT NULL REFERENCES documents(id),
  line_no              INTEGER NOT NULL CHECK (line_no > 0),
  po_document_id       TEXT NOT NULL,
  po_line_no           INTEGER NOT NULL,
  qty                  INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (document_id, line_no),
  FOREIGN KEY (po_document_id, po_line_no) REFERENCES pur_po_lines(document_id, line_no)
) STRICT;

CREATE TRIGGER pur_rr_lines_no_update BEFORE UPDATE ON pur_rr_lines
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted receiving report lines are cancelled, never edited'); END;
