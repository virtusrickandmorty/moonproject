-- The part of a set a piece rate is for (the owner's request, Oct 2026): a set (a jersey set, a uniform) is made as an
-- upper and a lower part, each paid at its own rate. 'whole' is a garment made as one piece: every rate before this.
ALTER TABLE rate_piece_rates ADD COLUMN part TEXT NOT NULL DEFAULT 'whole' CHECK (part IN ('whole', 'upper', 'lower'));
CREATE INDEX rate_piece_rates_part_key ON rate_piece_rates(garment_type, step_code, complexity, part, effective_from);
