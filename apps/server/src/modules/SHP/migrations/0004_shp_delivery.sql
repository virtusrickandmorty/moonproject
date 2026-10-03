-- Delivery for online orders: the owner lists the areas the shop delivers to with a fee each, saved with the payment
-- settings (each version keeps its own list). The buyer picks one at checkout; its name and fee stay on the order as they
-- were, the fee is paid with the order, and confirming records it on the quick sale as a "Delivery" service line.
CREATE TABLE shp_delivery_options (
  version INTEGER NOT NULL REFERENCES shp_payment_settings(version),
  position INTEGER NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  fee_cents INTEGER NOT NULL CHECK (fee_cents >= 0),
  PRIMARY KEY (version, position)
) STRICT;
CREATE TRIGGER shp_delivery_options_no_update BEFORE UPDATE ON shp_delivery_options BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: save new payment settings'); END;

ALTER TABLE shp_orders ADD COLUMN delivery_option TEXT;
ALTER TABLE shp_orders ADD COLUMN delivery_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0);
