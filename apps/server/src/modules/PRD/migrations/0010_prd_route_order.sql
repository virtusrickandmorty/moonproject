-- Each item's own step order (the owner's request, Oct 2026): after Cutting, one item is embroidered before Sewing and
-- another after it. A route's steps keep the order they were picked in; rows set up before this have no position and
-- keep the canonical order.
ALTER TABLE prd_line_setup_steps ADD COLUMN position INTEGER CHECK (position IS NULL OR position >= 1);

-- A second embroidery pass (the owner's request, Oct 2026): embroidered after Cutting, sewn, then embroidered again.
-- A step of its own, so its pieces, workers and piece rates are kept apart from the first pass; after Sewing by default.
INSERT INTO prd_steps (id, code, name, seq, pay_basis, is_active, updated_at) VALUES
  (9, 'EMBROIDERY_2', 'Embroidery (2nd pass)', 62, 'daily', 1, '2026-10-13T00:00:00.000+08:00');
