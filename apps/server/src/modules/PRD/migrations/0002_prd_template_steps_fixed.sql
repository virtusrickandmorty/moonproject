-- Route templates are seeded and read-only (PLAN E7). 0001 guarded prd_route_templates but not the steps of each template.
CREATE TRIGGER prd_route_template_steps_no_update BEFORE UPDATE ON prd_route_template_steps
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: route templates are seeded'); END;
