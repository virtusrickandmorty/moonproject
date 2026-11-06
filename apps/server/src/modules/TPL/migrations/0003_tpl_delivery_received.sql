-- Who received a delivery (the owner's request, Nov 2026), typed once the signed receipt comes back: a recorded delivery is never
-- changed, so this is a row of its own. Insert-only; the latest row counts, so a wrong name is corrected by a new one.
CREATE TABLE tpl_delivery_received (
  id          INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES tpl_deliveries(document_id),
  received_by TEXT NOT NULL,
  received_on TEXT NOT NULL,
  at          TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id)
) STRICT;
CREATE INDEX tpl_delivery_received_doc ON tpl_delivery_received(document_id, id);
CREATE TRIGGER tpl_delivery_received_no_update BEFORE UPDATE ON tpl_delivery_received BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: who received a delivery is a new row'); END;
CREATE TRIGGER tpl_delivery_received_no_delete BEFORE DELETE ON tpl_delivery_received BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: who received a delivery is kept'); END;
