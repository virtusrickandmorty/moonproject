-- TAX module tables (prefix tax_). PLAN D7, E12: the ATP booklet register. Every sales invoice and collection receipt
-- number typed from a BIR-approved booklet must fall inside a registered booklet of its kind (L7). Booklets are master
-- data: retired, never deleted, and a range never changes once registered.
CREATE TABLE tax_booklets (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('SALES_INVOICE', 'CR')),
  atp_no      TEXT NOT NULL CHECK (length(trim(atp_no)) >= 3), -- the BIR Authority to Print number on the booklet
  printer     TEXT,                                            -- the accredited printer, as printed
  serial_from INTEGER NOT NULL CHECK (serial_from >= 1),
  serial_to   INTEGER NOT NULL CHECK (serial_to <= 999999999999),
  received_on TEXT NOT NULL,                                   -- the day the booklet came from the printer
  note        TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  CHECK (serial_to >= serial_from),
  CHECK (serial_to - serial_from < 100000)                     -- a typo guard: a booklet is a few hundred forms
) STRICT;
CREATE INDEX tax_booklets_kind ON tax_booklets(kind, serial_from);

-- Only the active flag, the note and the version change. Kind, ATP number and range stay as registered.
CREATE TRIGGER tax_booklets_fixed BEFORE UPDATE ON tax_booklets
WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.atp_no IS NOT OLD.atp_no OR NEW.printer IS NOT OLD.printer
  OR NEW.serial_from IS NOT OLD.serial_from OR NEW.serial_to IS NOT OLD.serial_to OR NEW.received_on IS NOT OLD.received_on
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a registered booklet keeps its kind, ATP number and range'); END;

-- Two booklets of the same kind never share a number, active or not.
CREATE TRIGGER tax_booklets_no_overlap BEFORE INSERT ON tax_booklets
WHEN EXISTS (SELECT 1 FROM tax_booklets b WHERE b.kind = NEW.kind AND b.serial_from <= NEW.serial_to AND NEW.serial_from <= b.serial_to)
BEGIN SELECT RAISE(ABORT, 'BOOKLET_OVERLAP: the range overlaps a registered booklet'); END;
