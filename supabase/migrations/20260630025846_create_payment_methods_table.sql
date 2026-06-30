-- Create payment_methods table for managing payment methods
CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  name text NOT NULL,
  code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_cash boolean DEFAULT false,
  is_bank boolean DEFAULT false,
  account_id uuid REFERENCES accounts(id),
  sort_order integer DEFAULT 0,
  icon_name text,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, code)
);

-- Enable RLS
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "select_payment_methods" ON payment_methods FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "insert_payment_methods" ON payment_methods FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_payment_methods" ON payment_methods FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Seed default payment methods
INSERT INTO payment_methods (name, code, is_cash, is_bank, sort_order, icon_name) VALUES
  ('Cash', 'cash', true, false, 1, 'banknote'),
  ('Bank Transfer', 'bank_transfer', false, true, 2, 'building-2'),
  ('Card (Credit/Debit)', 'card', false, true, 3, 'credit-card'),
  ('Mobile Banking', 'mobile_banking', false, false, 4, 'smartphone'),
  ('Cheque', 'cheque', false, false, 5, 'file-text'),
  ('Other', 'other', false, false, 99, 'more-horizontal')
ON CONFLICT (tenant_id, code) DO NOTHING;