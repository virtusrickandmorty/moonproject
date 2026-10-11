-- Where rework was found (the owner's rule, Oct 2026): sent-back pieces start again at the first step and are labelled
-- rework up to and including the step where the fault was found; after it they are normal work again. Found at Sewing
-- (already sewn), they stay rework until the end of the route. NULL = not known (older send-backs copied on an edit):
-- rework to the end of the route, as before.
ALTER TABLE prd_reworks ADD COLUMN found_at_step_id INTEGER REFERENCES prd_steps(id);

-- Earlier send-backs kept the step only in their audit row: fill it in from there, once.
DROP TRIGGER prd_reworks_no_update;
UPDATE prd_reworks SET found_at_step_id = (
  SELECT json_extract(a.data, '$.foundAtStepId') FROM audit_log a
  WHERE a.action = 'prd.rework' AND json_extract(a.data, '$.id') = prd_reworks.id
);
CREATE TRIGGER prd_reworks_no_update BEFORE UPDATE ON prd_reworks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a rework send-back is kept as recorded'); END;
