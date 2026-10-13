-- Up to three photos a product (the owner's request, Oct 2026): photo_id stays the main one, shown on the cards; the
-- second and third show on the product's page. Each is a row of shp_photos, like the main one.
ALTER TABLE shp_products ADD COLUMN photo2_id TEXT REFERENCES shp_photos(id);
ALTER TABLE shp_products ADD COLUMN photo3_id TEXT REFERENCES shp_photos(id);
