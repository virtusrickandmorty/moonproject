CREATE TABLE pur_suppliers (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  registered_name      TEXT NOT NULL,
  tin                  TEXT NOT NULL,
  is_vat_registered    INTEGER NOT NULL DEFAULT 0 CHECK (is_vat_registered IN (0,1)),
  ewt_class            TEXT CHECK (ewt_class IN ('none', 'rent_5', 'contractor_2', 'prof_ind_5', 'prof_ind_10', 'prof_firm_10', 'prof_firm_15', 'goods_1', 'services_2')),
  sworn_declaration_until TEXT,
  payment_terms        TEXT,
  bank_details         TEXT,
  contacts             TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  legacy_id            TEXT
) STRICT;

CREATE TRIGGER pur_suppliers_no_delete BEFORE DELETE ON pur_suppliers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: master data is never deleted, only deactivated'); END;

CREATE TABLE pur_supplies (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  unit                 TEXT NOT NULL,
  category             TEXT NOT NULL CHECK (category IN ('materials', 'ready_made')),
  last_purchase_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (last_purchase_cost_cents >= 0),
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
) STRICT;

CREATE TRIGGER pur_supplies_no_delete BEFORE DELETE ON pur_supplies
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: master data is never deleted, only deactivated'); END;
