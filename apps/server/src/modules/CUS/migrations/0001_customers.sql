CREATE TABLE cus_sequences (
  key TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL CHECK (next_value > 0)
) STRICT;
INSERT INTO cus_sequences VALUES ('customer', 1);

CREATE TABLE cus_customers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('person','organization')),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  registered_name TEXT,
  tin TEXT,
  is_vat_registered INTEGER NOT NULL DEFAULT 0 CHECK (is_vat_registered IN (0,1)),
  withholding_profile TEXT NOT NULL DEFAULT 'none' CHECK (withholding_profile IN ('none','twa_goods','twa_services','government','platform')),
  billing_address TEXT,
  email TEXT,
  email_consent INTEGER NOT NULL DEFAULT 0 CHECK (email_consent IN (0,1)),
  credit_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (credit_terms_days BETWEEN 0 AND 365),
  parent_customer_id TEXT REFERENCES cus_customers(id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  merged_into_id TEXT REFERENCES cus_customers(id),
  legacy_id TEXT,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (parent_customer_id IS NULL OR parent_customer_id <> id),
  CHECK (merged_into_id IS NULL OR (merged_into_id <> id AND is_active = 0))
) STRICT;
CREATE INDEX cus_customers_name ON cus_customers(display_name);
CREATE INDEX cus_customers_parent ON cus_customers(parent_customer_id);

CREATE TABLE cus_customer_contacts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES cus_customers(id),
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  email TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX cus_customer_contacts_customer ON cus_customer_contacts(customer_id, is_active);

CREATE TABLE cus_customer_phones (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES cus_customers(id),
  phone TEXT NOT NULL,
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX cus_customer_phones_customer ON cus_customer_phones(customer_id, is_active);

CREATE TABLE cus_groups (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES cus_customers(id),
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX cus_groups_active_name ON cus_groups(customer_id, name COLLATE NOCASE) WHERE is_active = 1;

CREATE TABLE cus_people (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES cus_customers(id),
  group_id TEXT REFERENCES cus_groups(id),
  full_name TEXT NOT NULL,
  nickname TEXT,
  default_jersey_name TEXT,
  default_jersey_number TEXT,
  gender TEXT,
  birthday TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX cus_people_customer ON cus_people(customer_id, group_id);

CREATE TABLE cus_sizes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category TEXT NOT NULL CHECK (category IN ('adult','kids')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
) STRICT;
INSERT INTO cus_sizes (id,label,category) VALUES
  ('XS','XS','adult'),('S','S','adult'),('M','M','adult'),('L','L','adult'),
  ('XL','XL','adult'),('2XL','2XL','adult'),('3XL','3XL','adult'),
  ('4XL','4XL','adult'),('5XL','5XL','adult');

CREATE TABLE cus_measure_charts (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES cus_people(id),
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  status TEXT NOT NULL CHECK (status IN ('active','superseded','inactive')),
  size_mode TEXT NOT NULL CHECK (size_mode IN ('preset','measured')),
  upper_size TEXT REFERENCES cus_sizes(id),
  lower_size TEXT REFERENCES cus_sizes(id),
  unit TEXT NOT NULL DEFAULT 'inch' CHECK (unit IN ('inch','cm')),
  shoulder REAL, chest REAL, upper_waist REAL, collar REAL, bust_point REAL,
  figure_point REAL, bust_distance REAL, arm_hole REAL, sleeve_hole REAL,
  sleeve_length REAL, upper_length REAL, lower_waist REAL, hips REAL,
  crotch REAL, thigh REAL, calf REAL, ankle REAL, lower_length REAL,
  remarks TEXT,
  measured_by TEXT NOT NULL REFERENCES users(id),
  measured_on TEXT NOT NULL,
  reason TEXT,
  supersedes_id TEXT REFERENCES cus_measure_charts(id),
  UNIQUE(person_id, revision_no),
  CHECK (revision_no = 1 OR length(trim(coalesce(reason,''))) >= 3),
  CHECK (revision_no = 1 OR supersedes_id IS NOT NULL),
  CHECK (size_mode <> 'preset' OR upper_size IS NOT NULL OR lower_size IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX cus_measure_charts_one_active ON cus_measure_charts(person_id) WHERE status = 'active';
CREATE TRIGGER cus_measure_charts_immutable BEFORE UPDATE ON cus_measure_charts
WHEN OLD.status <> 'active' OR NEW.status NOT IN ('superseded','inactive') OR
  NEW.id <> OLD.id OR NEW.person_id <> OLD.person_id OR NEW.revision_no <> OLD.revision_no OR
  NEW.size_mode <> OLD.size_mode OR NEW.unit <> OLD.unit OR
  NEW.measured_by <> OLD.measured_by OR NEW.measured_on <> OLD.measured_on OR
  NEW.reason IS NOT OLD.reason OR NEW.supersedes_id IS NOT OLD.supersedes_id OR
  NEW.upper_size IS NOT OLD.upper_size OR NEW.lower_size IS NOT OLD.lower_size OR
  NEW.shoulder IS NOT OLD.shoulder OR NEW.chest IS NOT OLD.chest OR
  NEW.upper_waist IS NOT OLD.upper_waist OR NEW.collar IS NOT OLD.collar OR
  NEW.bust_point IS NOT OLD.bust_point OR NEW.figure_point IS NOT OLD.figure_point OR
  NEW.bust_distance IS NOT OLD.bust_distance OR NEW.arm_hole IS NOT OLD.arm_hole OR
  NEW.sleeve_hole IS NOT OLD.sleeve_hole OR NEW.sleeve_length IS NOT OLD.sleeve_length OR
  NEW.upper_length IS NOT OLD.upper_length OR NEW.lower_waist IS NOT OLD.lower_waist OR
  NEW.hips IS NOT OLD.hips OR NEW.crotch IS NOT OLD.crotch OR NEW.thigh IS NOT OLD.thigh OR
  NEW.calf IS NOT OLD.calf OR NEW.ankle IS NOT OLD.ankle OR NEW.lower_length IS NOT OLD.lower_length OR
  NEW.remarks IS NOT OLD.remarks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: insert a new measurement revision'); END;
