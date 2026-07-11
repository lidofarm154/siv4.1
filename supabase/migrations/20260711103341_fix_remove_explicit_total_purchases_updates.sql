-- =============================================================================
-- FIX: Remove explicit total_purchases updates from cancel_invoice and
-- edit_invoice that conflict with the trg_invoice_sync_total_purchases trigger.
--
-- The trigger correctly recalculates total_purchases = SUM(total_amount)
-- WHERE status <> 'cancelled' on any invoice INSERT/UPDATE/DELETE.
-- The explicit updates in the RPCs run AFTER the trigger and overwrite
-- the correct value with an incorrect arithmetic subtraction.
-- =============================================================================

-- 1. Remove total_purchases from cancel_invoice's customer UPDATE (step 7)
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
    -- total_purchases is maintained by trg_invoice_sync_total_purchases trigger

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
  -- total_purchases is maintained by trg_invoice_sync_total_purchases trigger

  -- 6. Record edit history
  INSERT INTO invoice_edit_history (
    invoice_id, invoice_number, edited_by_name, change_type, reason,
    snapshot_before, snapshot_after
  ) VALUES (
    p_invoice_id, v_invoice.invoice_number, p_cancelled_by, 'cancelled', p_reason,
    json_build_object('status', v_invoice.status, 'total_amount', v_invoice.total_amount, 'amount_paid', v_invoice.amount_paid),
    json_build_object('status', 'cancelled', 'total_amount', 0, 'amount_paid', 0)
  );

  -- 7. Update customer outstanding_balance only (total_purchases handled by trigger)
  IF v_invoice.customer_id IS NOT NULL THEN
    UPDATE customers
    SET outstanding_balance = (
      SELECT COALESCE(SUM(balance_due), 0)
      FROM invoices
      WHERE customer_id = v_invoice.customer_id
        AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')
    ),
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


-- 2. Remove total_purchases from edit_invoice's customer UPDATEs (step 6)
CREATE OR REPLACE FUNCTION public.edit_invoice(p_invoice_id uuid, p_new_data json, p_reason text DEFAULT NULL, p_edited_by text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_invoice          RECORD;
  v_new_customer     uuid;
  v_new_date         date;
  v_new_due_date     date;
  v_new_notes        text;
  v_new_items        json;
  v_new_subtotal     numeric := 0;
  v_new_total        numeric := 0;
  v_item             json;
  v_old_item         RECORD;
  v_qty              numeric;
  v_cost             numeric;
  v_line_total       numeric;
  v_ar_account       uuid;
  v_revenue_account  uuid;
  v_cogs_account     uuid;
  v_inventory_account uuid;
  v_default_wh       uuid;
  v_old_snapshot     json;
  v_new_snapshot     json;
  v_payment          RECORD;
  v_has_deliveries   boolean;
  v_has_returns      boolean;
  v_new_status       text;
  v_pay_num          text;
  v_je_id            uuid;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invoice not found');
  END IF;
  IF v_invoice.status = 'cancelled' THEN
    RETURN json_build_object('success', false, 'error', 'Cannot edit a cancelled invoice');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM deliveries WHERE invoice_id = p_invoice_id AND status = 'delivered'
  ) INTO v_has_deliveries;
  IF v_has_deliveries THEN
    RETURN json_build_object('success', false, 'error', 'Cannot edit invoice with completed deliveries');
  END IF;

  SELECT EXISTS(SELECT 1 FROM sales_returns WHERE invoice_id = p_invoice_id)
  INTO v_has_returns;
  IF v_has_returns THEN
    RETURN json_build_object('success', false, 'error', 'Cannot edit invoice with linked sales returns');
  END IF;

  v_new_customer   := (p_new_data->>'customer_id')::uuid;
  v_new_date       := (p_new_data->>'invoice_date')::date;
  v_new_due_date   := NULLIF(p_new_data->>'due_date', '')::date;
  v_new_notes      := p_new_data->>'notes';
  v_new_items      := p_new_data->'items';

  IF v_new_items IS NULL OR json_array_length(v_new_items) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Invoice must have at least one item');
  END IF;

  FOR v_item IN SELECT * FROM json_array_elements(v_new_items) LOOP
    v_line_total  := COALESCE((v_item->>'total')::numeric, (v_item->>'subtotal')::numeric, 0);
    v_new_subtotal := v_new_subtotal + v_line_total;
  END LOOP;
  v_new_total := v_new_subtotal;

  SELECT id INTO v_ar_account        FROM accounts WHERE code = '1100' LIMIT 1;
  SELECT id INTO v_revenue_account   FROM accounts WHERE code = '4000' LIMIT 1;
  SELECT id INTO v_cogs_account      FROM accounts WHERE code = '5000' LIMIT 1;
  SELECT id INTO v_inventory_account FROM accounts WHERE code = '1200' LIMIT 1;

  SELECT id INTO v_default_wh FROM warehouses WHERE is_default = true AND is_active = true LIMIT 1;
  IF v_default_wh IS NULL THEN
    SELECT id INTO v_default_wh FROM warehouses WHERE is_active = true LIMIT 1;
  END IF;

  SELECT json_build_object(
    'customer_id', v_invoice.customer_id,
    'invoice_date', v_invoice.invoice_date,
    'due_date',     v_invoice.due_date,
    'notes',        v_invoice.notes,
    'total_amount', v_invoice.total_amount,
    'amount_paid',  v_invoice.amount_paid,
    'status',       v_invoice.status,
    'items', (SELECT json_agg(row_to_json(ii)) FROM invoice_items ii WHERE ii.invoice_id = p_invoice_id)
  ) INTO v_old_snapshot;

  -- STEP 1: REVERSE OLD EFFECTS

  -- 1a. Restore stock
  FOR v_old_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id LOOP
    v_qty := COALESCE(v_old_item.base_quantity, v_old_item.quantity);
    IF v_default_wh IS NOT NULL AND v_qty > 0 THEN
      UPDATE inventory_items
      SET quantity_on_hand = quantity_on_hand + v_qty, updated_at = now()
      WHERE product_id = v_old_item.product_id AND warehouse_id = v_default_wh;

      IF NOT FOUND THEN
        INSERT INTO inventory_items (product_id, warehouse_id, quantity_on_hand, quantity_reserved, quantity_incoming)
        VALUES (v_old_item.product_id, v_default_wh, v_qty, 0, 0);
      END IF;

      INSERT INTO stock_movements (
        product_id, warehouse_id, movement_type, quantity, unit_cost,
        reference_type, reference_id, reference_number, notes
      ) VALUES (
        v_old_item.product_id, v_default_wh, 'return_in', v_qty, COALESCE(v_old_item.cost_price, 0),
        'invoice_edit', p_invoice_id, v_invoice.invoice_number,
        'Stock restore - invoice edit'
      );
    END IF;
  END LOOP;

  -- 1b. Reverse AR + Revenue
  IF v_ar_account IS NOT NULL AND v_revenue_account IS NOT NULL AND v_invoice.total_amount > 0 THEN
    PERFORM post_journal_entry(
      'REVERSAL - AR - Invoice ' || v_invoice.invoice_number || ' EDIT',
      COALESCE(v_invoice.invoice_date, CURRENT_DATE),
      'invoice_edit', p_invoice_id,
      json_build_array(
        json_build_object('account_id', v_ar_account,      'debit', 0,                       'credit', v_invoice.total_amount, 'description', 'Reverse AR for invoice edit '      || v_invoice.invoice_number),
        json_build_object('account_id', v_revenue_account, 'debit', v_invoice.total_amount,   'credit', 0,                     'description', 'Reverse revenue for invoice edit ' || v_invoice.invoice_number)
      )::json,
      v_invoice.customer_id
    );
  END IF;

  -- 1c. Reverse COGS
  IF v_cogs_account IS NOT NULL AND v_inventory_account IS NOT NULL THEN
    FOR v_old_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id LOOP
      v_qty  := COALESCE(v_old_item.base_quantity, v_old_item.quantity);
      v_cost := COALESCE(v_old_item.cost_price, 0);
      IF v_qty * v_cost > 0 THEN
        PERFORM post_journal_entry(
          'REVERSAL - COGS - Invoice ' || v_invoice.invoice_number || ' item EDIT',
          COALESCE(v_invoice.invoice_date, CURRENT_DATE),
          'invoice_edit', p_invoice_id,
          json_build_array(
            json_build_object('account_id', v_cogs_account,       'debit', 0,              'credit', v_qty * v_cost, 'description', 'Reverse COGS for invoice edit '             || v_invoice.invoice_number),
            json_build_object('account_id', v_inventory_account,  'debit', v_qty * v_cost, 'credit', 0,             'description', 'Reverse inventory release for invoice edit ' || v_invoice.invoice_number)
          )::json,
          v_invoice.customer_id
        );
      END IF;
    END LOOP;
  END IF;

  -- 1d. Reverse original payments (insert refund records for audit trail)
  FOR v_payment IN
    SELECT * FROM payments WHERE reference_type = 'invoice' AND reference_id = p_invoice_id
  LOOP
    INSERT INTO payments (
      payment_number, payment_type, payment_method, amount, payment_date,
      reference_type, reference_id, reference_number, customer_id, notes
    ) VALUES (
      'REV-' || COALESCE(v_payment.payment_number, 'PAY'),
      CASE WHEN v_payment.payment_type = 'received' THEN 'refund' ELSE 'payment' END,
      v_payment.payment_method,
      v_payment.amount,
      CURRENT_DATE,
      'invoice_edit', p_invoice_id,
      v_invoice.invoice_number,
      v_invoice.customer_id,
      'Reversal payment - invoice edit ' || v_invoice.invoice_number
    );
  END LOOP;

  -- Delete original 'invoice' JEs with balance rollback
  FOR v_je_id IN
    SELECT id FROM journal_entries
    WHERE reference_type = 'invoice' AND reference_id = p_invoice_id
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

  -- Delete original payment JEs with balance rollback
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

  -- STEP 2: UPDATE INVOICE HEADER
  UPDATE invoices
  SET customer_id  = v_new_customer,
      invoice_date = COALESCE(v_new_date, invoice_date),
      due_date     = v_new_due_date,
      notes        = v_new_notes,
      subtotal     = v_new_subtotal,
      total_amount = v_new_total,
      amount_paid  = 0,
      discount_amount = 0,
      status       = 'draft',
      edit_count   = COALESCE(edit_count, 0) + 1,
      updated_at   = now()
  WHERE id = p_invoice_id;

  -- STEP 3: DELETE OLD ITEMS, INSERT NEW ONES
  DELETE FROM invoice_items WHERE invoice_id = p_invoice_id;

  FOR v_item IN SELECT * FROM json_array_elements(v_new_items) LOOP
    INSERT INTO invoice_items (
      invoice_id, product_id, quantity, unit_price, cost_price,
      discount_percent, tax_rate, subtotal, unit_name,
      unit_conversion_factor, base_quantity
    ) VALUES (
      p_invoice_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric,
      COALESCE((v_item->>'cost_price')::numeric, 0),
      COALESCE((v_item->>'discount_percent')::numeric, 0),
      0,
      COALESCE((v_item->>'total')::numeric, (v_item->>'subtotal')::numeric, 0),
      NULLIF(v_item->>'unit_name', ''),
      NULLIF(v_item->>'unit_conversion_factor', '')::numeric,
      NULLIF(v_item->>'base_quantity', '')::numeric
    );
  END LOOP;

  -- STEP 4: RESTORE STATUS
  IF v_invoice.status = 'paid' THEN
    v_new_status := 'paid';
  ELSIF v_invoice.status = 'partially_paid' THEN
    v_new_status := 'sent';
  ELSE
    v_new_status := v_invoice.status;
  END IF;

  UPDATE invoices
  SET status = v_new_status, updated_at = now()
  WHERE id = p_invoice_id;

  IF v_invoice.status = 'paid' THEN
    v_pay_num := 'EDIT-PAY-' || substring(p_invoice_id::text, 1, 8);

    INSERT INTO payments (
      payment_number, payment_type, payment_method, amount, payment_date,
      reference_type, reference_id, reference_number, customer_id, notes
    ) VALUES (
      v_pay_num, 'received', 'cash',
      v_new_total, COALESCE(v_new_date, CURRENT_DATE),
      'invoice', p_invoice_id, v_invoice.invoice_number,
      COALESCE(v_new_customer, v_invoice.customer_id),
      'Auto-payment for edited paid invoice'
    );

    UPDATE invoices
    SET amount_paid = v_new_total, status = 'paid', updated_at = now()
    WHERE id = p_invoice_id;
  END IF;

  -- STEP 5: RECORD EDIT HISTORY
  SELECT json_build_object(
    'customer_id', v_new_customer,
    'invoice_date', v_new_date,
    'total_amount', v_new_total,
    'amount_paid',  CASE WHEN v_invoice.status = 'paid' THEN v_new_total ELSE 0 END,
    'status',       v_new_status,
    'items',        v_new_items
  ) INTO v_new_snapshot;

  INSERT INTO invoice_edit_history (
    invoice_id, invoice_number, edited_by_name, change_type, reason,
    snapshot_before, snapshot_after
  ) VALUES (
    p_invoice_id, v_invoice.invoice_number, p_edited_by,
    CASE
      WHEN v_invoice.customer_id <> v_new_customer THEN 'header_edit,full_edit'
      ELSE 'full_edit'
    END,
    p_reason, v_old_snapshot, v_new_snapshot
  );

  -- STEP 6: UPDATE CUSTOMER outstanding_balance ONLY
  -- total_purchases is maintained by trg_invoice_sync_total_purchases trigger
  IF v_invoice.customer_id IS NOT NULL AND v_invoice.customer_id <> COALESCE(v_new_customer, v_invoice.customer_id) THEN
    UPDATE customers
    SET outstanding_balance = (
      SELECT COALESCE(SUM(balance_due), 0)
      FROM invoices
      WHERE customer_id = v_invoice.customer_id
        AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')
    ),
    updated_at = now()
    WHERE id = v_invoice.customer_id;
  END IF;

  IF v_new_customer IS NOT NULL THEN
    UPDATE customers
    SET outstanding_balance = (
      SELECT COALESCE(SUM(balance_due), 0)
      FROM invoices
      WHERE customer_id = v_new_customer
        AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')
    ),
    updated_at = now()
    WHERE id = v_new_customer;
  END IF;

  RETURN json_build_object(
    'success',       true,
    'message',       'Invoice updated successfully',
    'invoice_number', v_invoice.invoice_number,
    'old_total',     v_invoice.total_amount,
    'new_total',     v_new_total
  );
END;
$function$;
