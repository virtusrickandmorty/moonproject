CREATE TABLE dash_notification_reads (
  user_id TEXT NOT NULL REFERENCES users(id),
  notification_key TEXT NOT NULL CHECK (length(notification_key) BETWEEN 1 AND 200),
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, notification_key)
) STRICT;
