-- Part of a wearer's pieces (the owner's request, Oct 2026): a wearer with 8 pieces had 3 done, and Record pieces could
-- only take all 8. A row with one wearer ticked may now be for some of theirs; the wearer is done on the step once all
-- their pieces are recorded there. NULL (every row before this, and rework): all the wearer's pieces.
ALTER TABLE prd_assignment_wearers ADD COLUMN pieces INTEGER CHECK (pieces IS NULL OR pieces >= 1);

DROP VIEW prd_line_assignment_wearers;
CREATE VIEW prd_line_assignment_wearers AS
  SELECT w.assignment_id, a.job_order_id AS jo, a.line_no AS line, w.roster_row_no, w.pieces FROM prd_assignment_wearers w
    JOIN prd_assignments a ON a.id = w.assignment_id
  UNION ALL
  SELECT w.assignment_id, m.job_order_id AS jo, m.line_no AS line, m.row_no AS roster_row_no, w.pieces FROM prd_assignment_wearers w
    JOIN prd_assignments a ON a.id = w.assignment_id
    JOIN prd_carry_over_wearers m ON m.from_job_order_id = a.job_order_id AND m.from_line_no = a.line_no AND m.from_row_no = w.roster_row_no;
