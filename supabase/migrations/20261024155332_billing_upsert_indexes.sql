-- Stripe webhooks failed with "there is no unique or exclusion constraint matching the ON CONFLICT specification":
-- @aimhuge/billing upserts invoices on (provider, provider_invoice_id) and cards on (org_id, provider_payment_method_id)
-- through supabase-js, whose ON CONFLICT names columns only and so can't use the partial indexes 20261014010429_billing.sql
-- made (WHERE … IS NOT NULL). Plain unique indexes behave the same, since Postgres treats NULLs as distinct: mock rows
-- with no provider id still never collide.

drop index if exists public.org_invoices_provider_invoice_idx;
create unique index org_invoices_provider_invoice_idx
  on public.org_invoices (provider, provider_invoice_id);

drop index if exists public.org_payment_methods_provider_idx;
create unique index org_payment_methods_provider_idx
  on public.org_payment_methods (org_id, provider_payment_method_id);
