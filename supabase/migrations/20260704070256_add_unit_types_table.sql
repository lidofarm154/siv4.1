/*
# Add Unit Types Table

## Summary
Creates a centrally managed unit_types table so admins can define standard measurement
units (with short codes) that are then selected when setting up multi-unit products.

## New Tables

### unit_types
Defines standard measurement/packaging units available across the ERP.

Columns:
- `id` (uuid, primary key)
- `unit_name` (text, unique, not null) — full name, e.g. "Piece", "Box", "Carton"
- `unit_short` (text, not null) — abbreviation, e.g. "pcs", "box", "ctn"
- `is_active` (boolean, default true) — soft delete
- `created_at` (timestamptz)

## Security
- RLS enabled; authenticated users can CRUD, anon users can SELECT (needed for POS/online store)

## Seed Data
Pre-populates 12 common building material units.
*/

CREATE TABLE IF NOT EXISTS unit_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_name TEXT NOT NULL,
  unit_short TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(unit_name)
);

ALTER TABLE unit_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_unit_types" ON unit_types;
CREATE POLICY "select_unit_types" ON unit_types FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_unit_types" ON unit_types;
CREATE POLICY "insert_unit_types" ON unit_types FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_unit_types" ON unit_types;
CREATE POLICY "update_unit_types" ON unit_types FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_unit_types" ON unit_types;
CREATE POLICY "delete_unit_types" ON unit_types FOR DELETE
  TO authenticated USING (true);

-- Seed common units (idempotent)
INSERT INTO unit_types (unit_name, unit_short) VALUES
  ('Piece',        'pcs'),
  ('Box',          'box'),
  ('Bag',          'bag'),
  ('Carton',       'ctn'),
  ('Tin',          'tin'),
  ('Set',          'set'),
  ('Kilogram',     'kg'),
  ('Liter',        'ltr'),
  ('Meter',        'mtr'),
  ('Square Feet',  'sqft'),
  ('Coil',         'coil'),
  ('Roll',         'roll')
ON CONFLICT (unit_name) DO NOTHING;
