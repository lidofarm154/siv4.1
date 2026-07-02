/*
# Recalculate All Account Balances From Journal Lines

## Problem
The sales return flow in the frontend was updating account balances with an
`updated_at` column that doesn't exist on the `accounts` table. This caused
every balance update to fail silently, leaving account balances stale after
sales return journal entries were posted. Multiple accounts have incorrect
balances as a result.

## Changes
1. Recalculate the balance of every active account from all posted journal
   lines, using the correct debit/credit direction based on account_type:
   - asset/expense: balance = sum(debits) - sum(credits)
   - liability/equity/revenue: balance = sum(credits) - sum(debits)

## Notes
- This is a one-time correction. Going forward, the frontend code has been
  fixed to remove the invalid `updated_at` field, so balance updates will
  succeed.
- Accounts with no journal lines retain their existing balance (e.g. opening
  balances for bank accounts like 1002 that were set up via initial migration).
- No data is lost — only the balance column is recalculated.
*/

UPDATE accounts a
SET balance = COALESCE(
  (SELECT
    CASE
      WHEN a.account_type IN ('asset', 'expense') THEN
        COALESCE(SUM(jl.debit - jl.credit), 0)
      ELSE
        COALESCE(SUM(jl.credit - jl.debit), 0)
    END
   FROM journal_lines jl
   JOIN journal_entries je ON jl.journal_entry_id = je.id
   WHERE jl.account_id = a.id
     AND je.is_posted = true
  ),
  a.balance
)
WHERE a.is_active = true
  AND EXISTS (
    SELECT 1 FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_entry_id = je.id
    WHERE jl.account_id = a.id AND je.is_posted = true
  );
