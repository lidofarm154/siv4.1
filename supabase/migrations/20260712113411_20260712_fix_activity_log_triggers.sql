-- Re-create activity log trigger function (idempotent)
CREATE OR REPLACE FUNCTION log_activity()
RETURNS TRIGGER AS $$
DECLARE
  v_label TEXT;
  v_entity_type TEXT;
  v_action TEXT;
BEGIN
  -- Determine action label
  v_action := CASE TG_OP
    WHEN 'INSERT' THEN 'create'
    WHEN 'UPDATE' THEN 'update'
    WHEN 'DELETE' THEN 'delete'
    ELSE TG_OP
  END;

  IF TG_TABLE_NAME = 'invoices' THEN
    v_entity_type := 'invoice';
    v_label := CASE
      WHEN TG_OP = 'INSERT' THEN 'Invoice ' || NEW.invoice_number || ' created'
      WHEN TG_OP = 'UPDATE' AND NEW.status = 'cancelled' THEN 'Invoice ' || NEW.invoice_number || ' cancelled'
      WHEN TG_OP = 'UPDATE' THEN 'Invoice ' || NEW.invoice_number || ' updated (' || NEW.status || ')'
      ELSE 'Invoice deleted'
    END;
    v_action := CASE
      WHEN TG_OP = 'INSERT' THEN 'sale'
      WHEN TG_OP = 'UPDATE' AND NEW.status = 'cancelled' THEN 'cancel'
      ELSE 'update'
    END;
  ELSIF TG_TABLE_NAME = 'quotations' THEN
    v_entity_type := 'quotation';
    v_label := CASE
      WHEN TG_OP = 'INSERT' THEN 'Quotation ' || NEW.quote_number || ' created'
      WHEN TG_OP = 'UPDATE' AND NEW.status = 'converted' THEN 'Quotation ' || NEW.quote_number || ' converted to invoice'
      WHEN TG_OP = 'UPDATE' THEN 'Quotation ' || NEW.quote_number || ' status: ' || NEW.status
      ELSE 'Quotation deleted'
    END;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    v_entity_type := CASE WHEN NEW.payment_type = 'received' THEN 'payment_received' ELSE 'purchase_order' END;
    v_label := 'Payment ' || NEW.payment_number || ' of ' || ROUND(NEW.amount::numeric, 2)::text || ' recorded';
    v_action := 'payment';
  ELSIF TG_TABLE_NAME = 'purchase_orders' THEN
    v_entity_type := 'purchase_order';
    v_label := CASE
      WHEN TG_OP = 'INSERT' THEN 'Purchase order ' || NEW.po_number || ' created'
      WHEN TG_OP = 'UPDATE' THEN 'Purchase order ' || NEW.po_number || ' status: ' || NEW.status
      ELSE 'Purchase order deleted'
    END;
    v_action := CASE WHEN TG_OP = 'INSERT' THEN 'purchase' ELSE 'update' END;
  ELSIF TG_TABLE_NAME = 'deliveries' THEN
    v_entity_type := 'delivery';
    v_label := CASE
      WHEN TG_OP = 'INSERT' THEN 'Delivery ' || NEW.delivery_number || ' created'
      WHEN TG_OP = 'UPDATE' THEN 'Delivery ' || NEW.delivery_number || ' status: ' || NEW.status
      ELSE 'Delivery deleted'
    END;
    v_action := 'delivery';
  ELSIF TG_TABLE_NAME = 'customers' THEN
    v_entity_type := 'customer';
    v_label := CASE
      WHEN TG_OP = 'INSERT' THEN 'New customer: ' || NEW.name
      WHEN TG_OP = 'UPDATE' THEN 'Customer ' || NEW.name || ' updated'
      ELSE 'Customer deleted'
    END;
    v_action := CASE WHEN TG_OP = 'INSERT' THEN 'customer' ELSE 'update' END;
  ELSIF TG_TABLE_NAME = 'online_orders' THEN
    v_entity_type := 'online_order';
    v_label := CASE
      WHEN TG_OP = 'INSERT' THEN 'Online order ' || NEW.order_number || ' received'
      WHEN TG_OP = 'UPDATE' THEN 'Online order ' || NEW.order_number || ' status: ' || NEW.status
      ELSE 'Online order deleted'
    END;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO activity_logs (tenant_id, action, entity_type, entity_id, entity_label)
  VALUES (
    '00000000-0000-0000-0000-000000000001',
    v_action,
    v_entity_type,
    CASE TG_OP WHEN 'DELETE' THEN OLD.id ELSE NEW.id END,
    v_label
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and re-create all activity log triggers
DROP TRIGGER IF EXISTS trg_log_invoices ON invoices;
DROP TRIGGER IF EXISTS trg_log_quotations ON quotations;
DROP TRIGGER IF EXISTS trg_log_payments ON payments;
DROP TRIGGER IF EXISTS trg_log_purchase_orders ON purchase_orders;
DROP TRIGGER IF EXISTS trg_log_deliveries ON deliveries;
DROP TRIGGER IF EXISTS trg_log_customers ON customers;
DROP TRIGGER IF EXISTS trg_log_online_orders ON online_orders;

CREATE TRIGGER trg_log_invoices
  AFTER INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_log_quotations
  AFTER INSERT OR UPDATE ON quotations
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_log_payments
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_log_purchase_orders
  AFTER INSERT OR UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_log_deliveries
  AFTER INSERT OR UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_log_customers
  AFTER INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION log_activity();

CREATE TRIGGER trg_log_online_orders
  AFTER INSERT OR UPDATE ON online_orders
  FOR EACH ROW EXECUTE FUNCTION log_activity();

-- Seed activity_logs from existing data (most recent from each entity)
-- Clear stale zeros first
DELETE FROM activity_logs WHERE created_at < now() - interval '1 hour';

INSERT INTO activity_logs (tenant_id, action, entity_type, entity_id, entity_label, created_at)
SELECT '00000000-0000-0000-0000-000000000001', 'sale', 'invoice',
       id, 'Invoice ' || invoice_number || ' (' || status || ')', created_at
FROM invoices
ORDER BY created_at DESC
LIMIT 20
ON CONFLICT DO NOTHING;

INSERT INTO activity_logs (tenant_id, action, entity_type, entity_id, entity_label, created_at)
SELECT '00000000-0000-0000-0000-000000000001', 'payment', 'payment_received',
       id, 'Payment ' || payment_number || ' of ' || ROUND(amount::numeric, 2)::text || ' recorded', created_at
FROM payments
ORDER BY created_at DESC
LIMIT 20
ON CONFLICT DO NOTHING;

INSERT INTO activity_logs (tenant_id, action, entity_type, entity_id, entity_label, created_at)
SELECT '00000000-0000-0000-0000-000000000001', 'create', 'quotation',
       id, 'Quotation ' || quote_number || ' (' || status || ')', created_at
FROM quotations
ORDER BY created_at DESC
LIMIT 10
ON CONFLICT DO NOTHING;

INSERT INTO activity_logs (tenant_id, action, entity_type, entity_id, entity_label, created_at)
SELECT '00000000-0000-0000-0000-000000000001', 'purchase', 'purchase_order',
       id, 'Purchase order ' || po_number || ' - ' || status, created_at
FROM purchase_orders
ORDER BY created_at DESC
LIMIT 10
ON CONFLICT DO NOTHING;

INSERT INTO activity_logs (tenant_id, action, entity_type, entity_id, entity_label, created_at)
SELECT '00000000-0000-0000-0000-000000000001', 'delivery', 'delivery',
       id, 'Delivery ' || delivery_number || ' - ' || status, created_at
FROM deliveries
ORDER BY created_at DESC
LIMIT 10
ON CONFLICT DO NOTHING;
