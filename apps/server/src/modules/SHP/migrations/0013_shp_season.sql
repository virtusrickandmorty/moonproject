-- The website's seasonal decorations (the owner's request, Oct 2026): Automatic (by the calendar), Off, or one season.
-- A new version for each change, never updated; the latest one counts.
CREATE TABLE shp_season_settings (
  version INTEGER PRIMARY KEY CHECK (version >= 1),
  mode TEXT NOT NULL CHECK (mode IN ('auto', 'off', 'halloween', 'christmas', 'valentines', 'summer', 'school')),
  saved_by TEXT NOT NULL REFERENCES users(id),
  saved_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER shp_season_settings_no_update BEFORE UPDATE ON shp_season_settings BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: save a new version'); END;
