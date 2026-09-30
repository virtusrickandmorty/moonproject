-- Supplier advances (PLAN D5 SUP-ADV): money paid to a supplier before its bill, applied on the supplier's bills, or
-- returned by the supplier. What is still open on an advance is never stored: it is read from the ledger (1230 lines
-- with the advance as ref_doc_id). Rows are insert-only: a document is cancelled, never edited.

-- Supplier advance (SADV-): Dr 1230 (the whole advance) / Cr 2311 EWT withheld on it / Cr the cash places.
CREATE TABLE ap_advances (
  document_id       TEXT PRIMARY KEY REFERENCES documents(id),
  supplier_id       TEXT NOT NULL,        -- a PUR supplier
  purchase_order_id TEXT,                 -- a PUR purchase order (PO-) it is a downpayment on, or NULL
  vat_registered    INTEGER NOT NULL CHECK (vat_registered IN (0,1)),
  vat_rate_bp       INTEGER NOT NULL CHECK (vat_rate_bp >= 0),
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  ewt_class         TEXT,
  ewt_rate_bp       INTEGER NOT NULL CHECK (ewt_rate_bp >= 0),
  ewt_base_cents    INTEGER NOT NULL CHECK (ewt_base_cents >= 0),
  ewt_cents         INTEGER NOT NULL CHECK (ewt_cents >= 0),
  cash_cents        INTEGER NOT NULL CHECK (cash_cents > 0),
  note              TEXT,
  CHECK (cash_cents + ewt_cents = amount_cents),
  CHECK (ewt_class IS NOT NULL OR (ewt_rate_bp = 0 AND ewt_base_cents = 0 AND ewt_cents = 0))
) STRICT;
CREATE INDEX ap_advances_supplier ON ap_advances(supplier_id);

CREATE TABLE ap_advance_tenders (
  document_id  TEXT NOT NULL REFERENCES ap_advances(document_id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference    TEXT,
  PRIMARY KEY (document_id, line_no)
) STRICT;

-- An advance applied on a supplier bill (in the bill's own journal: Dr 2101 / Cr 1230). covered_base_cents is the part
-- of the bill's EWT base the advance already withheld on, so the bill leaves it out of its own EWT.
CREATE TABLE ap_bill_advances (
  document_id        TEXT NOT NULL REFERENCES ap_bills(document_id),
  line_no            INTEGER NOT NULL CHECK (line_no >= 1),
  advance_id         TEXT NOT NULL REFERENCES ap_advances(document_id),
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  covered_base_cents INTEGER NOT NULL CHECK (covered_base_cents >= 0),
  PRIMARY KEY (document_id, line_no)
) STRICT;
CREATE INDEX ap_bill_advances_advance ON ap_bill_advances(advance_id);

-- Supplier advance return (SADR-): the supplier gives back an unused advance. Dr the cash places / Cr 1230.
CREATE TABLE ap_advance_returns (
  document_id  TEXT PRIMARY KEY REFERENCES documents(id),
  advance_id   TEXT NOT NULL REFERENCES ap_advances(document_id),
  note         TEXT
) STRICT;
CREATE INDEX ap_advance_returns_advance ON ap_advance_returns(advance_id);

CREATE TABLE ap_advance_return_tenders (
  document_id  TEXT NOT NULL REFERENCES ap_advance_returns(document_id),
  line_no      INTEGER NOT NULL CHECK (line_no >= 1),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference    TEXT,
  PRIMARY KEY (document_id, line_no)
) STRICT;

CREATE TRIGGER ap_advances_no_update BEFORE UPDATE ON ap_advances BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted supplier advances are cancelled, never edited'); END;
CREATE TRIGGER ap_advance_tenders_no_update BEFORE UPDATE ON ap_advance_tenders BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted supplier advances are cancelled, never edited'); END;
CREATE TRIGGER ap_bill_advances_no_update BEFORE UPDATE ON ap_bill_advances BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted supplier bills are cancelled, never edited'); END;
CREATE TRIGGER ap_advance_returns_no_update BEFORE UPDATE ON ap_advance_returns BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted advance returns are cancelled, never edited'); END;
CREATE TRIGGER ap_advance_return_tenders_no_update BEFORE UPDATE ON ap_advance_return_tenders BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted advance returns are cancelled, never edited'); END;
