-- The city a visit comes from (the owner's request, Nov 2026), as Cloudflare reads it from the visitor's internet connection
-- (its "visitor location" header): a guess, never an address, and the IP itself is still not kept. Null when not known.
ALTER TABLE shp_events ADD COLUMN city TEXT;
