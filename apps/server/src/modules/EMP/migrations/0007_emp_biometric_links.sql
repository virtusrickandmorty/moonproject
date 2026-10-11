-- Which employee a biometric user is (the owner's request, Oct 2026): the attendance report names people by the device's
-- User ID and a short name ("1", "json"), so each is linked to an employee once and remembered for the next import.
-- Insert-only: a new row for the same User ID (seq + 1) relinks it; employee_id NULL unlinks it.
CREATE TABLE emp_biometric_links (
  biometric_user_id TEXT NOT NULL CHECK (length(biometric_user_id) BETWEEN 1 AND 40),
  seq               INTEGER NOT NULL CHECK (seq >= 1),
  employee_id       TEXT REFERENCES emp_employees(id),
  device_name       TEXT, -- the name the device shows, for the screen
  at                TEXT NOT NULL,
  user_id           TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (biometric_user_id, seq)
) STRICT;

CREATE TRIGGER emp_biometric_links_no_update BEFORE UPDATE ON emp_biometric_links
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a biometric link is changed by a new row'); END;
