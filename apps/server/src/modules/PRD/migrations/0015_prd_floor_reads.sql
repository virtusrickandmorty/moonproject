-- What each worker has read on the floor app's bell (the owner's request, Nov 2026). The notifications (a new job on
-- their steps, a job falling due) are worked out from the open jobs each time; this keeps only which ones they have read.
CREATE TABLE prd_floor_reads (
  user_id          TEXT NOT NULL REFERENCES users(id),
  notification_key TEXT NOT NULL CHECK (length(notification_key) BETWEEN 1 AND 200),
  read_at          TEXT NOT NULL,
  PRIMARY KEY (user_id, notification_key)
) STRICT;
