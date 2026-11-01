-- Phone notifications (the owner's request, Nov 2026): the phones (browser push subscriptions) each person turned
-- notifications on for, and which of their notifications were already pushed, so each is pushed once.
CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  endpoint   TEXT NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 10 AND 1000),
  p256dh     TEXT NOT NULL CHECK (length(p256dh) BETWEEN 10 AND 200),
  auth       TEXT NOT NULL CHECK (length(auth) BETWEEN 8 AND 100),
  device     TEXT NOT NULL CHECK (length(device) <= 200),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id, is_active);

CREATE TABLE push_sent (
  user_id          TEXT NOT NULL REFERENCES users(id),
  notification_key TEXT NOT NULL CHECK (length(notification_key) BETWEEN 1 AND 200),
  sent_at          TEXT NOT NULL,
  PRIMARY KEY (user_id, notification_key)
) STRICT;
