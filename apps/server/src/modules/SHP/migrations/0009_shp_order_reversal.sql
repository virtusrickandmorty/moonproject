-- A confirmed order cancelled or returned by staff: the order is marked cancelled, and these say which of the two it was
-- (returned: the pieces had already gone out or been handed over), who did it, when, and the reason. All empty until then.
-- The linked quick sale and its payment are cancelled by QS, which puts the pieces back in stock. Once per order: a set
-- reversal_kind is never changed.
ALTER TABLE shp_orders ADD COLUMN reversal_kind TEXT CHECK (reversal_kind IN ('cancelled', 'returned'));
ALTER TABLE shp_orders ADD COLUMN reversal_reason TEXT;
ALTER TABLE shp_orders ADD COLUMN reversal_by TEXT REFERENCES users(id);
ALTER TABLE shp_orders ADD COLUMN reversal_at TEXT;
CREATE TRIGGER shp_orders_reversal_once BEFORE UPDATE OF reversal_kind, reversal_reason, reversal_by, reversal_at ON shp_orders
  WHEN OLD.reversal_kind IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an order is cancelled or returned only once'); END;
