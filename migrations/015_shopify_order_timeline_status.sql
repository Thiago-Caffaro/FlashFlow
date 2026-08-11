-- 015_shopify_order_timeline_status.sql
-- Persists Shopify lifecycle fields used to distinguish payment and cancellation.

ALTER TABLE public.fulfillment_orders
  ADD COLUMN IF NOT EXISTS shopify_financial_status text,
  ADD COLUMN IF NOT EXISTS shopify_fulfillment_status text,
  ADD COLUMN IF NOT EXISTS shopify_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS shopify_cancel_reason text,
  ADD COLUMN IF NOT EXISTS shopify_closed_at timestamptz;

UPDATE public.fulfillment_orders
SET
  shopify_financial_status = nullif(raw_shopify_payload ->> 'financial_status', ''),
  shopify_fulfillment_status = nullif(raw_shopify_payload ->> 'fulfillment_status', ''),
  shopify_cancelled_at = CASE
    WHEN (raw_shopify_payload ->> 'cancelled_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      THEN (raw_shopify_payload ->> 'cancelled_at')::timestamptz
    ELSE null
  END,
  shopify_cancel_reason = nullif(raw_shopify_payload ->> 'cancel_reason', ''),
  shopify_closed_at = CASE
    WHEN (raw_shopify_payload ->> 'closed_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      THEN (raw_shopify_payload ->> 'closed_at')::timestamptz
    ELSE null
  END,
  updated_at = now()
WHERE source = 'shopify'
  AND raw_shopify_payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS fulfillment_orders_shopify_cancelled_idx
  ON public.fulfillment_orders (shopify_cancelled_at DESC)
  WHERE source = 'shopify' AND shopify_cancelled_at IS NOT NULL;
