-- When each notification first came up, so the bell and the list show the newest on top (the owner's request, Oct 2026).
-- Notifications are worked out from the books each time; this keeps only the moment one was first seen.
CREATE TABLE dash_notification_seen (
  notification_key TEXT PRIMARY KEY CHECK (length(notification_key) BETWEEN 1 AND 200),
  first_seen_at TEXT NOT NULL
) STRICT;
