-- Clean up stale original + reversal JEs for INV-940528 that net to zero.
-- These were created before the edit_invoice fix was applied.
-- The corrective migration already posted the correct new entries.
-- Deleting these four JEs has zero net effect on account balances
-- because the original postings and their reversals cancel out.

DO $$
DECLARE
  v_je_id uuid;
  v_inv_id uuid := 'f3baa0a4-723b-46ba-b4a6-b3cc814bcfde'; -- INV-940528
BEGIN
  -- Delete the original 'invoice' JEs (pre-edit) and 'invoice_edit' reversal JEs.
  -- The corrective 'invoice' JEs (CORR-INV-940528-*) remain as the correct postings.
  FOR v_je_id IN
    SELECT id FROM journal_entries
    WHERE reference_id = v_inv_id
      AND (
        (reference_type = 'invoice' AND entry_number = 'JE-000001')
        OR
        (reference_type = 'invoice_edit')
      )
  LOOP
    -- Roll back account balances for this JE
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

    DELETE FROM journal_lines WHERE journal_entry_id = v_je_id;
    DELETE FROM journal_entries  WHERE id = v_je_id;
  END LOOP;

  RAISE NOTICE 'Stale JEs for INV-940528 cleaned up.';
END;
$$;
