-- Players fill in their own details for the coach (the owner's request, Nov 2026): on a team list, the coach makes a link for
-- the players; each player sends their own row (name on the back, number, gender, sizes or measurements) to the coach, not to
-- the shop. The coach checks the rows in their list and only the coach sends the whole list (an answer, as before).

-- A coach's list of players: the coach's own key (only its hash kept) and the link the coach sends to the players.
CREATE TABLE olk_team_lists (
  id           TEXT PRIMARY KEY,
  link_id      TEXT NOT NULL REFERENCES olk_links(id),
  coach_hash   TEXT NOT NULL UNIQUE,
  player_token TEXT NOT NULL UNIQUE CHECK (length(player_token) BETWEEN 20 AND 64),
  coach_name   TEXT CHECK (coach_name IS NULL OR length(coach_name) <= 120),
  ip           TEXT,
  created_at   TEXT NOT NULL
) STRICT;
CREATE INDEX olk_team_lists_link ON olk_team_lists(link_id);

-- A player's own row, as they sent it (the person as the answer takes it, checked, kept as JSON until the coach sends the
-- list). The player changes it with their own key (only its hash kept). The coach may take it off their list; when the coach
-- sends the list, the rows on it are stamped.
CREATE TABLE olk_team_entries (
  id           TEXT PRIMARY KEY,
  list_id      TEXT NOT NULL REFERENCES olk_team_lists(id),
  edit_hash    TEXT NOT NULL UNIQUE,
  person       TEXT NOT NULL CHECK (json_valid(person)),
  ip           TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  removed_at   TEXT,
  in_answer_at TEXT
) STRICT;
CREATE INDEX olk_team_entries_list ON olk_team_entries(list_id, created_at);
