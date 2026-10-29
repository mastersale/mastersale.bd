-- Optional demo data for local testing. Do NOT run on your live database unless you want sample products.
INSERT INTO categories (name, slug, sort) VALUES ('Fashion','fashion',1),('Electronics','electronics',2),('Home','home',3);
INSERT INTO products (slug,name,short_desc,description,category_id,price,discount_type,discount_value,stock,featured,media,specs) VALUES
('classic-leather-wallet','Classic Leather Wallet','Slim genuine leather, six card slots.','Hand finished leather wallet.',1,1450,'percent',20,25,1,'[]','[{"key":"Material","value":"Genuine leather"},{"key":"Colour","value":"Tan"}]'),
('wireless-earbuds','Wireless Earbuds','30 hour battery with charging case.','Bluetooth 5.3 earbuds.',2,3200,'fixed',500,3,1,'[]','[{"key":"Battery","value":"30 hours"}]'),
('ceramic-mug-set','Ceramic Mug Set','Set of four, dishwasher safe.','',3,990,'none',0,0,0,'[]','[]');
