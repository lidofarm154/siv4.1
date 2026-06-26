/*
# Fix Accounting Automation Triggers

## Problem
The accounting automation migration (20260621) created four database triggers
that reference columns and tables which do not exist in the actual schema.
As a result, every trigger fails at runtime, blocking inserts/updates on
invoices, payments, goods_receipt_notes, and stock_movements.

## Bugs Fixed

1. **invoice_accounting_trigger**
   - Referenced `NEW.customer_name` (no such column on `invoices`).
   - Checked for status `confirmed` (actual statuses are draft/sent/paid/
     partially_paid/overdue/cancelled/refunded).
   - Recalculated total from `invoice_items` using non-existent `discount`
     column; the table stores `discount_percent` and `tax_rate`, and the
     invoice row already carries `total_amount`.

2. **payment_accounting_trigger**
   - Referenced `NEW.reference` (no such column; actual column is
     `reference_number`).

3. **grn_accounting_trigger**
   - Referenced non-existent `grn_items` table (GRN has no child line-item
     table; it relies on `purchase_order_items`).
   - Referenced `NEW.grn_date` (actual column is `received_date`).
   - Checked for status `received`/`completed` (actual GRN statuses are
     draft/verified/posted).

4. **stock_movement_accounting_trigger**
   - Already correct against the schema; left unchanged but re-created
     for idempotency.

## Changes
- Replaces all four trigger functions with corrected versions that match
  the real column names and status values.
- Invoice trigger now fires on transition to `sent` (credit sale) or
  `paid` (cash sale), using `NEW.total_amount` directly.
- Payment trigger uses `NEW.reference_number` instead of `NEW.reference`.
- GRN trigger reads from `purchase_order_items` using
  `received_quantity * unit_cost`, and fires on transition to `posted`.
- All triggers use `NEW.tenant_id` with the standard default fallback.

## Security
- No RLS or policy changes. No new tables or columns.
- Triggers run with the privileges of the calling role.
*/

-- ============================================================
-- 1. invoice_accounting_trigger (FIXED)
-- ============================================================
CREATE OR REPLACE FUNCTION invoice_accounting_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_total_amount decimal(15,2);
  v_tenant_id uuid;
  v_customer_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IN ('sent', 'paid') AND OLD.status = 'draft' THEN
    v_total_amount := COALESCE(NEW.total_amount, 0);
    v_tenant_id := COALESCE(NEW.tenant_id, '00000000-0000-0000-0000-000000000001');

    SELECT name INTO v_customer_name FROM customers WHERE id = NEW.customer_id;

    IF v_total_amount > 0 THEN
      PERFORM post_journal_entry(
        p_description := 'Invoice #' || NEW.invoice_number || ' - ' || COALESCE(v_customer_name, 'Customer'),
        p_lines := jsonb_build_array(
          jsonb_build_object('account_code', '1100', 'debit', v_total_amount, 'description', 'Accounts Receivable'),
          jsonb_build_object('account_code', '4000', 'credit', v_total_amount, 'description', 'Sales Revenue')
        ),
        p_entry_date := NEW.invoice_date,
        p_reference_type := 'invoice',
        p_reference_id := NEW.id,
        p_tenant_id := v_tenant_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoice_accounting ON invoices;
CREATE TRIGGER invoice_accounting
  AFTER UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION invoice_accounting_trigger();

-- ============================================================
-- 2. payment_accounting_trigger (FIXED)
-- ============================================================
CREATE OR REPLACE FUNCTION payment_accounting_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tenant_id := COALESCE(NEW.tenant_id, '00000000-0000-0000-0000-000000000001');

    PERFORM post_journal_entry(
      p_description := 'Payment received - ' || COALESCE(NEW.payment_method, 'Payment') || ' - Ref: ' || COALESCE(NEW.reference_number, NEW.id::text),
      p_lines := jsonb_build_array(
        jsonb_build_object('account_code', CASE WHEN NEW.payment_method ILIKE '%bank%' OR NEW.payment_method ILIKE '%transfer%' OR NEW.payment_method ILIKE '%card%' THEN '1010' ELSE '1000' END, 'debit', NEW.amount, 'description', 'Cash/Bank'),
        jsonb_build_object('account_code', '1100', 'credit', NEW.amount, 'description', 'Accounts Receivable')
      ),
      p_entry_date := NEW.payment_date,
      p_reference_type := 'payment',
      p_reference_id := NEW.id,
      p_tenant_id := v_tenant_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_accounting ON payments;
CREATE TRIGGER payment_accounting
  AFTER INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION payment_accounting_trigger();

-- ============================================================
-- 3. grn_accounting_trigger (FIXED)
-- ============================================================
CREATE OR REPLACE FUNCTION grn_accounting_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_total_amount decimal(15,2);
  v_tenant_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IN ('draft', 'verified', 'pending') THEN
    SELECT COALESCE(SUM(received_quantity * unit_cost), 0)
    INTO v_total_amount
    FROM purchase_order_items
    WHERE purchase_order_id = NEW.purchase_order_id;

    v_tenant_id := COALESCE(NEW.tenant_id, '00000000-0000-0000-0000-000000000001');

    IF v_total_amount > 0 THEN
      PERFORM post_journal_entry(
        p_description := 'GRN #' || NEW.grn_number || ' - Goods Received',
        p_lines := jsonb_build_array(
          jsonb_build_object('account_code', '1200', 'debit', v_total_amount, 'description', 'Inventory'),
          jsonb_build_object('account_code', '2000', 'credit', v_total_amount, 'description', 'Accounts Payable')
        ),
        p_entry_date := NEW.received_date,
        p_reference_type := 'grn',
        p_reference_id := NEW.id,
        p_tenant_id := v_tenant_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS grn_accounting ON goods_receipt_notes;
CREATE TRIGGER grn_accounting
  AFTER UPDATE ON goods_receipt_notes
  FOR EACH ROW
  EXECUTE FUNCTION grn_accounting_trigger();

-- ============================================================
-- 4. stock_movement_accounting_trigger (unchanged logic, re-created)
-- ============================================================
CREATE OR REPLACE FUNCTION stock_movement_accounting_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant_id uuid;
  v_amount decimal(15,2);
  v_ref_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tenant_id := COALESCE(NEW.tenant_id, '00000000-0000-0000-0000-000000000001');
    v_amount := ABS(NEW.quantity) * COALESCE(NEW.unit_cost, 0);

    IF v_amount > 0 THEN
      IF NEW.movement_type = 'return_in' THEN
        v_ref_type := 'sales_return';
        PERFORM post_journal_entry(
          p_description := 'Sales Return - ' || COALESCE(NEW.reference_number, NEW.id::text) || ' - ' || COALESCE(NEW.notes, 'Customer Return'),
          p_lines := jsonb_build_array(
            jsonb_build_object('account_code', '4100', 'debit', v_amount, 'description', 'Sales Returns & Allowances'),
            jsonb_build_object('account_code', '1200', 'credit', v_amount, 'description', 'Inventory')
          ),
          p_entry_date := CURRENT_DATE,
          p_reference_type := v_ref_type,
          p_reference_id := NEW.id,
          p_tenant_id := v_tenant_id
        );
      ELSIF NEW.movement_type = 'return_out' THEN
        v_ref_type := 'purchase_return';
        PERFORM post_journal_entry(
          p_description := 'Purchase Return - ' || COALESCE(NEW.reference_number, NEW.id::text) || ' - ' || COALESCE(NEW.notes, 'Supplier Return'),
          p_lines := jsonb_build_array(
            jsonb_build_object('account_code', '2000', 'debit', v_amount, 'description', 'Accounts Payable'),
            jsonb_build_object('account_code', '1200', 'credit', v_amount, 'description', 'Inventory')
          ),
          p_entry_date := CURRENT_DATE,
          p_reference_type := v_ref_type,
          p_reference_id := NEW.id,
          p_tenant_id := v_tenant_id
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_movement_accounting ON stock_movements;
CREATE TRIGGER stock_movement_accounting
  AFTER INSERT ON stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION stock_movement_accounting_trigger();