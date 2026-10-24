# 038: Stripe payments never upgraded the plan (ON CONFLICT vs partial indexes)

- **Date:** 2026-10-24
- **Severity:** High. Affects production: every paid checkout failed to sync its invoice and card.

## Symptom

After a sandbox payment, local Weft's webhook answered 500 for `checkout.session.completed` and `invoice.paid`
("Handler failed"). The workspace stayed on its old plan. The server log said:
`Payment method sync failed: there is no unique or exclusion constraint matching the ON CONFLICT specification`
and the same for `Invoice sync failed`.

## Root cause

`20261014010429_billing.sql` made `org_invoices_provider_invoice_idx` and `org_payment_methods_provider_idx` partial
(`WHERE provider_invoice_id IS NOT NULL`, `WHERE provider_payment_method_id IS NOT NULL`). @aimhuge/billing upserts with
`onConflict: "provider,provider_invoice_id"` and `"org_id,provider_payment_method_id"`; PostgREST sends
`ON CONFLICT (cols)` without the index predicate, and Postgres can't infer a partial index from that.

## Fix

`supabase/migrations/20261024155332_billing_upsert_indexes.sql` (applied live) drops both and recreates them as plain
unique indexes on the same columns. Postgres treats NULLs as distinct, so mock rows with no provider id still never collide.

```sql
-- before
create unique index org_invoices_provider_invoice_idx on public.org_invoices (provider, provider_invoice_id)
  where provider_invoice_id is not null;
-- after
create unique index org_invoices_provider_invoice_idx on public.org_invoices (provider, provider_invoice_id);
```

**Key rule:** an index an upsert's `onConflict` names must be a plain unique index; supabase-js can't carry a predicate.

## Files

- `supabase/migrations/20261024155332_billing_upsert_indexes.sql`
- `scripts/stripe-replay-local.mjs` (replays the failed events), `scripts/stripe-listen-secret-check.mjs`
- `docs/architecture/billing.md`
- The package's own SQL still has the partial indexes: a card in ~/dev/components.
