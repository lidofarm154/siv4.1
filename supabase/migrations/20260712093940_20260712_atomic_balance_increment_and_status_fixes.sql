
-- Atomic account balance increment function (eliminates stale-read race condition)
CREATE OR REPLACE FUNCTION public.increment_account_balance(
  p_account_id uuid,
  p_delta      numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE accounts
  SET balance = balance + p_delta,
      updated_at = now()
  WHERE id = p_account_id;
END;
$$;

-- Ensure invoices_status_check allows all statuses used in codebase
-- (partially_paid is already there, this is a safety assertion — recreate if needed)
DO $$
BEGIN
  -- Verify 'partially_paid' is in the constraint — if not, drop and recreate
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_status_check'
    AND pg_get_constraintdef(oid) LIKE '%partially_paid%'
  ) THEN
    ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
    ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
      CHECK (status IN ('draft','sent','partially_paid','paid','overdue','cancelled','refunded'));
  END IF;
END $$;

-- Grant execute on the new function to authenticated and anon
GRANT EXECUTE ON FUNCTION public.increment_account_balance(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_account_balance(uuid, numeric) TO anon;
