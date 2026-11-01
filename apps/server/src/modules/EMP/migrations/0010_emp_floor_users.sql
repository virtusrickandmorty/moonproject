-- A worker's own sign-in for the floor app (the owner's request, Nov 2026): which user account is which employee, so the
-- phone records that worker's own pieces and shows their own earnings. Insert-only: the latest row of an employee is the
-- link in force (user_id NULL: none); a user is linked to one employee at a time (checked when a link is made).
CREATE TABLE emp_floor_users (
  seq         INTEGER PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES emp_employees(id),
  user_id     TEXT REFERENCES users(id),
  at          TEXT NOT NULL,
  by_user_id  TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX emp_floor_users_employee ON emp_floor_users(employee_id, seq);
CREATE INDEX emp_floor_users_user ON emp_floor_users(user_id, seq);
CREATE TRIGGER emp_floor_users_no_update BEFORE UPDATE ON emp_floor_users
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a new link is a new row'); END;
