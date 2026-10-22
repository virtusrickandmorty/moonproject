-- How the customer paid money that went into the petty cash fund (the owner's request, Oct 2026): in cash, by bank
-- transfer or by e-wallet (the last two with their reference on the tender). Other tenders have no row.
CREATE TABLE col_tender_received_as (
  document_id TEXT NOT NULL,
  line_no     INTEGER NOT NULL,
  received_as TEXT NOT NULL CHECK (received_as IN ('cash', 'bank', 'ewallet')),
  PRIMARY KEY (document_id, line_no),
  FOREIGN KEY (document_id, line_no) REFERENCES col_tenders(document_id, line_no)
) STRICT;
