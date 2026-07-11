-- =============================================================================
-- FIX: cancel_invoice — reverse original payment journal entries
--
-- Bug: Step 4 inserts refund payment records, but payment_accounting_trigger
-- skips refund-type payments. The original payment JEs (Debit Cash, Credit AR)
-- are never reversed, causing AR to go negative and Cash to be overstated
-- after cancellation.
--
-- Fix: After inserting refund records, delete original payment JEs for this
-- invoice's payments, with account balance rollback.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancel_invoice(p_invoice_id uuid, p_reason text DEFAULT NULL, p_cancelled_by text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_invoice RECORD;
  v_ar_account uuid;
  v_revenue_account uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_default_wh uuid;
  v_item RECORD;
  v_qty numeric;
  v_cost numeric;
  v_payment RECORD;
  v_total_payments numeric := 0;
  v_has_deliveries boolean;
  v_has_returns boolean;
  v_je_id uuid;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invoice not found');
  END IF;

  IF v_invoice.status = 'cancelled' THEN
    RETURN json_build_object('success', false, 'error', 'Invoice is already cancelled');
  END IF;

  -- Draft: just mark cancelled, no accounting reversals needed
  IF v_invoice.status = 'draft' THEN
    UPDATE invoices
    SET status = 'cancelled',
        amount_paid = 0,
        total_amount = 0,
        subtotal = 0,
        updated_at = now()
    WHERE id = p_invoice_id;

    IF v_invoice.customer_id IS NOT NULL AND v_invoice.total_amount > 0 THEN
      UPDATE customers
      SET total_purchases = GREATEST(0, total_purchases - v_invoice.total_amount),
          updated_at = now()
      WHERE id = v_invoice.customer_id;
    END IF;

    INSERT INTO invoice_edit_history (
      invoice_id, invoice_number, edited_by_name, change_type, reason,
      snapshot_before, snapshot_after
    ) VALUES (
      p_invoice_id, v_invoice.invoice_number, p_cancelled_by, 'cancelled', p_reason,
      json_build_object('status', v_invoice.status, 'total_amount', v_invoice.total_amount),
      json_build_object('status', 'cancelled')
    );
    RETURN json_build_object('success', true, 'message', 'Draft invoice cancelled (no reversals needed)');
  END IF;

  -- Check for completed deliveries
  SELECT EXISTS(
    SELECT 1 FROM deliveries WHERE invoice_id = p_invoice_id AND status = 'delivered'
  ) INTO v_has_deliveries;
  IF v_has_deliveries THEN
    RETURN json_build_object('success', false, 'error', 'Cannot cancel invoice with completed deliveries. Please handle the delivery first.');
  END IF;

  -- Check for sales returns
  SELECT EXISTS(
    SELECT 1 FROM sales_returns WHERE invoice_id = p_invoice_id
  ) INTO v_has_returns;
  IF v_has_returns THEN
    RETURN json_build_object('success', false, 'error', 'Cannot cancel invoice with linked sales returns. Please process a refund or remove the return first.');
  END IF;

  SELECT id INTO v_ar_account       FROM accounts WHERE code = '1100' LIMIT 1;
  SELECT id INTO v_revenue_account  FROM accounts WHERE code = '4000' LIMIT 1;
  SELECT id INTO v_cogs_account     FROM accounts WHERE code = '5000' LIMIT 1;
  SELECT id INTO v_inventory_account FROM accounts WHERE code = '1200' LIMIT 1;

  SELECT id INTO v_default_wh FROM warehouses WHERE is_default = true AND is_active = true LIMIT 1;
  IF v_default_wh IS NULL THEN
    SELECT id INTO v_default_wh FROM warehouses WHERE is_active = true LIMIT 1;
  END IF;

  -- 1. Restore stock
  FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id LOOP
    v_qty := COALESCE(v_item.base_quantity, v_item.quantity);
    IF v_default_wh IS NOT NULL THEN
      UPDATE inventory_items
      SET quantity_on_hand = quantity_on_hand + v_qty, updated_at = now()
      WHERE product_id = v_item.product_id AND warehouse_id = v_default_wh;

      IF NOT FOUND THEN
        INSERT INTO inventory_items (product_id, warehouse_id, quantity_on_hand, quantity_reserved, quantity_incoming)
        VALUES (v_item.product_id, v_default_wh, v_qty, 0, 0);
      END IF;

      INSERT INTO stock_movements (
        product_id, warehouse_id, movement_type, quantity, unit_cost,
        reference_type, reference_id, reference_number, notes
      ) VALUES (
        v_item.product_id, v_default_wh, 'return_in', v_qty, COALESCE(v_item.cost_price, 0),
        'invoice_cancel', p_invoice_id, v_invoice.invoice_number,
        'Stock restoration - invoice cancelled'
      );
    END IF;
  END LOOP;

  -- 2. Reverse AR + Revenue journal entry
  IF v_ar_account IS NOT NULL AND v_revenue_account IS NOT NULL AND v_invoice.total_amount > 0 THEN
    PERFORM post_journal_entry(
      'REVERSAL - Accounts Receivable - Invoice ' || v_invoice.invoice_number || ' CANCELLED',
      COALESCE(v_invoice.invoice_date, CURRENT_DATE),
      'invoice_cancel', p_invoice_id,
      json_build_array(
        json_build_object('account_id', v_ar_account,       'debit', 0,                       'credit', v_invoice.total_amount, 'description', 'Reverse AR for cancelled invoice '      || v_invoice.invoice_number),
        json_build_object('account_id', v_revenue_account,  'debit', v_invoice.total_amount,   'credit', 0,                     'description', 'Reverse revenue for cancelled invoice ' || v_invoice.invoice_number)
      )::json,
      v_invoice.customer_id
    );
  END IF;

  -- 3. Reverse COGS
  IF v_cogs_account IS NOT NULL AND v_inventory_account IS NOT NULL THEN
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id LOOP
      v_qty  := COALESCE(v_item.base_quantity, v_item.quantity);
      v_cost := COALESCE(v_item.cost_price, 0);
      IF v_qty * v_cost > 0 THEN
        PERFORM post_journal_entry(
          'REVERSAL - COGS - Invoice ' || v_invoice.invoice_number || ' CANCELLED',
          COALESCE(v_invoice.invoice_date, CURRENT_DATE),
          'invoice_cancel', p_invoice_id,
          json_build_array(
            json_build_object('account_id', v_cogs_account,       'debit', 0,              'credit', v_qty * v_cost, 'description', 'Reverse COGS for cancelled invoice '             || v_invoice.invoice_number),
            json_build_object('account_id', v_inventory_account,  'debit', v_qty * v_cost, 'credit', 0,             'description', 'Reverse inventory release for cancelled invoice ' || v_invoice.invoice_number)
          )::json,
          v_invoice.customer_id
        );
      END IF;
    END LOOP;
  END IF;

  -- 4. Reverse original payments (insert refund records for audit trail)
  FOR v_payment IN SELECT * FROM payments WHERE reference_type = 'invoice' AND reference_id = p_invoice_id LOOP
    v_total_payments := v_total_payments + v_payment.amount::numeric;

    INSERT INTO payments (
      payment_number, payment_type, payment_method, amount, payment_date,
      reference_type, reference_id, reference_number, notes
    ) VALUES (
      'REV-' || COALESCE(v_payment.payment_number, 'PAY'),
      CASE WHEN v_payment.payment_type = 'received' THEN 'refund' ELSE 'payment' END,
      v_payment.payment_method,
      v_payment.amount,
      CURRENT_DATE,
      'invoice_cancel', p_invoice_id,
      v_invoice.invoice_number,
      'Reversal payment for cancelled invoice ' || v_invoice.invoice_number
    );
  END LOOP;

  -- 4a. Delete original payment journal entries with account balance rollback.
  --     The refund records inserted above don't generate JEs because
  --     payment_accounting_trigger skips refund-type payments. Without this
  --     reversal, the original Cash debit / AR credit JEs remain, causing
  --     AR to go negative and Cash to be overstated.
  FOR v_je_id IN
    SELECT je.id FROM journal_entries je
    WHERE je.reference_type = 'payment'
      AND je.reference_id IN (
        SELECT id FROM payments
        WHERE reference_type = 'invoice' AND reference_id = p_invoice_id
      )
  LOOP
    UPDATE accounts a
    SET balance = balance - (
      CASE
        WHEN a.account_type IN ('asset', 'expense')
          THEN COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)
        ELSE
          COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0)
      END
    )
    FROM journal_lines jl
    WHERE jl.journal_entry_id = v_je_id
      AND a.id = jl.account_id;

    DELETE FROM journal_lines  WHERE journal_entry_id = v_je_id;
    DELETE FROM journal_entries WHERE id = v_je_id;
  END LOOP;

  -- 5. Mark invoice cancelled and zero out amounts so balance_due = 0
  UPDATE invoices
  SET status      = 'cancelled',
      amount_paid = 0,
      total_amount = 0,
      updated_at  = now()
  WHERE id = p_invoice_id;

  -- 6. Record edit history
  INSERT INTO invoice_edit_history (
    invoice_id, invoice_number, edited_by_name, change_type, reason,
    snapshot_before, snapshot_after
  ) VALUES (
    p_invoice_id, v_invoice.invoice_number, p_cancelled_by, 'cancelled', p_reason,
    json_build_object('status', v_invoice.status, 'total_amount', v_invoice.total_amount, 'amount_paid', v_invoice.amount_paid),
    json_build_object('status', 'cancelled', 'total_amount', 0, 'amount_paid', 0)
  );

  -- 7. Update customer outstanding_balance and total_purchases
  IF v_invoice.customer_id IS NOT NULL THEN
    UPDATE customers
    SET outstanding_balance = (
      SELECT COALESCE(SUM(balance_due), 0)
      FROM invoices
      WHERE customer_id = v_invoice.customer_id
        AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')
    ),
    total_purchases = GREATEST(0, total_purchases - v_invoice.total_amount),
    updated_at = now()
    WHERE id = v_invoice.customer_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', 'Invoice cancelled successfully',
    'invoice_number', v_invoice.invoice_number,
    'stock_restored', true,
    'journal_reversed', true,
    'payments_reversed', v_total_payments > 0,
    'total_payments_reversed', v_total_payments
  );
END;
$function$;
