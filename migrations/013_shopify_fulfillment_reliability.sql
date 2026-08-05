-- 013_shopify_fulfillment_reliability.sql
-- Archives Shopify-deleted orders and lets variants that share a SKU reuse
-- the same local fulfillment product mirror.

ALTER TABLE public.fulfillment_orders
  ADD COLUMN IF NOT EXISTS shopify_deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS fulfillment_orders_active_shopify_idx
  ON public.fulfillment_orders (shopify_integration_id, created_at DESC)
  WHERE source = 'shopify' AND shopify_deleted_at IS NULL;

DROP INDEX IF EXISTS public.shopify_products_local_product_unique_idx;

CREATE INDEX IF NOT EXISTS shopify_products_local_product_idx
  ON public.shopify_products (local_product_id)
  WHERE local_product_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_shopify_products_local_copy(
  p_ids uuid[],
  p_enabled boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_count integer := 0;
  product_row record;
  mirror_id uuid;
  matching_mirror_id uuid;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_ids) > 1000 THEN
    RAISE EXCEPTION 'No maximo 1000 produtos podem ser alterados por vez';
  END IF;

  IF NOT p_enabled THEN
    UPDATE public.shopify_products
    SET
      keep_local_copy = false,
      local_product_id = null,
      updated_at = now()
    WHERE id = ANY(p_ids);
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RETURN affected_count;
  END IF;

  FOR product_row IN
    SELECT
      sp.id,
      sp.local_product_id,
      coalesce(si.default_country, 'DESCONHECIDO') AS mirror_country,
      coalesce(nullif(sp.sku, ''), 'SHOPIFY-' || sp.id::text) AS mirror_sku,
      CASE WHEN nullif(sp.variant_title, '') IS NULL
        THEN sp.title
        ELSE sp.title || ' - ' || sp.variant_title
      END AS mirror_name,
      sp.price,
      sp.currency
    FROM public.shopify_products AS sp
    LEFT JOIN public.shopify_integrations AS si ON si.id = sp.shopify_integration_id
    WHERE sp.id = ANY(p_ids)
      AND sp.hidden = false
    ORDER BY sp.id
  LOOP
    SELECT id
    INTO matching_mirror_id
    FROM public.fulfillment_products
    WHERE country = product_row.mirror_country
      AND sku = product_row.mirror_sku
    LIMIT 1;

    mirror_id := coalesce(matching_mirror_id, product_row.local_product_id);
    IF mirror_id IS NULL THEN
      INSERT INTO public.fulfillment_products (
        country, sku, name, price, currency, active, created_at, updated_at
      ) VALUES (
        product_row.mirror_country,
        product_row.mirror_sku,
        product_row.mirror_name,
        product_row.price,
        product_row.currency,
        true,
        now(),
        now()
      )
      RETURNING id INTO mirror_id;
    ELSE
      UPDATE public.fulfillment_products
      SET
        country = product_row.mirror_country,
        sku = product_row.mirror_sku,
        name = product_row.mirror_name,
        price = product_row.price,
        currency = product_row.currency,
        active = true,
        updated_at = now()
      WHERE id = mirror_id;
    END IF;

    UPDATE public.shopify_products
    SET
      keep_local_copy = true,
      local_product_id = mirror_id,
      updated_at = now()
    WHERE id = product_row.id;
    affected_count := affected_count + 1;
  END LOOP;

  RETURN affected_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_shopify_products_local_copy(uuid[], boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_shopify_products_local_copy(uuid[], boolean)
  TO service_role;
