-- A wearer's garment type on a job order roster (the owner's request, Oct 2026), typed by hand (e.g. "Jersey (men)",
-- "Shorts"). Optional, so every row recorded before it stays as it was (NULL). ADD COLUMN keeps the table and its triggers.
ALTER TABLE jo_roster ADD COLUMN garment_type TEXT CHECK (garment_type IS NULL OR length(garment_type) BETWEEN 1 AND 60);
