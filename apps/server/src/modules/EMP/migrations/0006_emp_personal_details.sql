-- More about the person, for the employee record: sex (as on their government IDs and the 2316), home address and their own
-- contact number. Personal fields: the audit log names them when they change, never their values (C6). Birthday is already
-- kept (birthday).
ALTER TABLE emp_employees ADD COLUMN gender TEXT CHECK (gender IS NULL OR gender IN ('male', 'female'));
ALTER TABLE emp_employees ADD COLUMN home_address TEXT;
ALTER TABLE emp_employees ADD COLUMN contact_no TEXT;
