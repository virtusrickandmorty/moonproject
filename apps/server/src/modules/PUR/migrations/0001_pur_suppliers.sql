CREATE TABLE pur_suppliers (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  registered_name      TEXT NOT NULL,
  tin                  TEXT,
  is_vat_registered    INTEGER NOT NULL DEFAULT 0 CHECK (is_vat_registered IN (0,1)),
  ewt_class            TEXT CHECK (ewt_class IN ('rent_5', 'contractor_2', 'prof_ind_5', 'prof_ind_10', 'prof_firm_10', 'prof_firm_15', 'goods_1', 'services_2')),
  sworn_declaration_until TEXT,
  payment_terms_days   INTEGER,
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  legacy_id            TEXT,
  version              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;

CREATE TABLE pur_supplier_contacts (
  id                   TEXT PRIMARY KEY,
  supplier_id          TEXT NOT NULL REFERENCES pur_suppliers(id),
  name                 TEXT NOT NULL,
  role                 TEXT,
  phone                TEXT,
  email                TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;

CREATE TABLE pur_supplies (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  unit                 TEXT NOT NULL CHECK (unit IN ('yard', 'meter', 'kg', 'roll', 'pc')),
  category             TEXT NOT NULL CHECK (category IN ('materials', 'ready_made')),
  last_purchase_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (last_purchase_cost_cents >= 0),
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;
