-- The shop's own events for the website's decorations (the owner's request, Oct 2026): their dates, the banner's words,
-- a colour theme, the shop's picture or a drawing, what drifts over the banner, the cards' doodles and the button.
-- Master data: changed with a version, hidden (is_active 0) rather than deleted.
CREATE TABLE shp_season_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  eyebrow TEXT NOT NULL,
  title TEXT NOT NULL,
  highlight TEXT NOT NULL,
  text TEXT NOT NULL,
  bar_text TEXT NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('night', 'purple', 'festive', 'rose', 'ocean', 'gold', 'sunset', 'emerald')),
  art TEXT NOT NULL CHECK (art IN ('none', 'picture', 'halloween', 'christmas', 'valentines', 'summer', 'school')),
  shower TEXT NOT NULL CHECK (shower IN ('none', 'confetti', 'stars', 'hearts', 'snow', 'bats')),
  doodles TEXT NOT NULL CHECK (doodles IN ('none', 'party', 'halloween', 'christmas', 'valentines', 'summer', 'school')),
  button TEXT NOT NULL CHECK (button IN ('quote', 'made', 'ready', 'services')),
  button_label TEXT NOT NULL,
  picture_type TEXT CHECK (picture_type IS NULL OR picture_type IN ('image/jpeg', 'image/png', 'image/webp')),
  picture BLOB,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  CHECK (ends_on >= starts_on)
) STRICT;
CREATE INDEX shp_season_events_dates ON shp_season_events(starts_on, ends_on);
