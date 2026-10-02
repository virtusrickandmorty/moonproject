-- Filing confirmations and their voids are separate immutable records; neither moves money.
CREATE TABLE tax_filed_returns (
  id          INTEGER PRIMARY KEY,
  form        TEXT NOT NULL CHECK (form IN ('2550Q', '0619-E', '1601-EQ', '1702Q', '1702', '1601-FQ', '1601-C')),
  period      TEXT NOT NULL,
  filed_on    TEXT NOT NULL,
  reference   TEXT NOT NULL CHECK (length(trim(reference)) BETWEEN 3 AND 100),
  note        TEXT,
  recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX tax_filed_returns_period ON tax_filed_returns(form, period, recorded_at, id);
CREATE TRIGGER tax_filed_returns_no_update BEFORE UPDATE ON tax_filed_returns
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: void a filed return, never edit it'); END;

CREATE TABLE tax_filed_return_voids (
  return_id   INTEGER PRIMARY KEY REFERENCES tax_filed_returns(id),
  reason      TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 500),
  voided_at   TEXT NOT NULL,
  voided_by   TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE TRIGGER tax_filed_return_voids_no_update BEFORE UPDATE ON tax_filed_return_voids
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a filed return void cannot be edited'); END;
