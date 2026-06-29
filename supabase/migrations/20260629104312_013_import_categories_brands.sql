/*
# Import Product Categories and Brands

## Overview
Adds the categories and brands needed for the inventory import:
- Sanitary Ware category
- Metal category  
- Stella brand
- Suzon brand
- Rosa brand
- Astra brand
*/

-- Categories
INSERT INTO categories (id, name, slug, sort_order, is_active) VALUES
  ('30000000-0000-0000-0000-000000000001', 'Sanitary Ware', 'sanitary-ware', 10, true),
  ('30000000-0000-0000-0000-000000000002', 'Metal', 'metal', 11, true)
ON CONFLICT (id) DO NOTHING;

-- Brands
INSERT INTO brands (id, name, slug, country_of_origin, is_active) VALUES
  ('40000000-0000-0000-0000-000000000001', 'Stella', 'stella', 'Bangladesh', true),
  ('40000000-0000-0000-0000-000000000002', 'Suzon', 'suzon', 'Bangladesh', true),
  ('40000000-0000-0000-0000-000000000003', 'Rosa', 'rosa', 'Bangladesh', true),
  ('40000000-0000-0000-0000-000000000004', 'Astra', 'astra', 'Bangladesh', true)
ON CONFLICT (id) DO NOTHING;