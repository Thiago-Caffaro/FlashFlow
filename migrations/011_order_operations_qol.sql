-- 011_order_operations_qol.sql
-- Notification dismissal and transactional bulk management of Shopify mirrors.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

CREATE INDEX IF NOT EXISTS notifications_instance_active_idx
  ON public.notifications (instance_name, created_at DESC)
  WHERE dismissed_at IS NULL;

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
  mirror_owner_id uuid;
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
    mirror_id := product_row.local_product_id;
    IF mirror_id IS NULL THEN
      SELECT id
      INTO mirror_id
      FROM public.fulfillment_products
      WHERE country = product_row.mirror_country
        AND sku = product_row.mirror_sku
      LIMIT 1;

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
      END IF;
    END IF;

    SELECT id
    INTO mirror_owner_id
    FROM public.shopify_products
    WHERE local_product_id = mirror_id
      AND id <> product_row.id
    LIMIT 1;

    IF mirror_owner_id IS NOT NULL THEN
      CONTINUE;
    END IF;

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
