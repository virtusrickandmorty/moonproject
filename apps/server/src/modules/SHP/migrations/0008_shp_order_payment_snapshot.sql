-- Each online order keeps the payment settings it was placed under: their version (the QR, bank and instructions the buyer was
-- shown) and the cash place the payment is recorded to when staff confirm it. Orders placed before this have neither (null)
-- and keep using the latest settings.
ALTER TABLE shp_orders ADD COLUMN payment_version INTEGER REFERENCES shp_payment_settings(version);
ALTER TABLE shp_orders ADD COLUMN cash_place_id INTEGER;
