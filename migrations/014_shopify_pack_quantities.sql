-- 014_shopify_pack_quantities.sql
-- Stores the physical unit multiplier for Shopify variants sold as packs.

ALTER TABLE public.shopify_products
  ADD COLUMN IF NOT EXISTS units_per_pack integer NOT NULL DEFAULT 1;

ALTER TABLE public.fulfillment_products
  ADD COLUMN IF NOT EXISTS units_per_pack integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shopify_products_units_per_pack_check'
  ) THEN
    ALTER TABLE public.shopify_products
      ADD CONSTRAINT shopify_products_units_per_pack_check
      CHECK (units_per_pack BETWEEN 1 AND 1000);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fulfillment_products_units_per_pack_check'
  ) THEN
    ALTER TABLE public.fulfillment_products
      ADD CONSTRAINT fulfillment_products_units_per_pack_check
      CHECK (units_per_pack BETWEEN 1 AND 1000);
  END IF;
END $$;

WITH parsed AS (
  SELECT
    id,
    btrim(regexp_replace(sku, ',\s*[1-9][0-9]{0,3}\s*$', '')) AS clean_sku,
    substring(sku FROM ',\s*([1-9][0-9]{0,3})\s*$')::integer AS pack_units
  FROM public.shopify_products
  WHERE sku ~ ',\s*[1-9][0-9]{0,3}\s*$'
)
UPDATE public.shopify_products AS product
SET
  sku = parsed.clean_sku,
  units_per_pack = parsed.pack_units,
  updated_at = now()
FROM parsed
WHERE product.id = parsed.id
  AND parsed.clean_sku <> ''
  AND parsed.pack_units BETWEEN 1 AND 1000;

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
      sp.units_per_pack,
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
        country, sku, name, units_per_pack, price, currency, active, created_at, updated_at
      ) VALUES (
        product_row.mirror_country,
        product_row.mirror_sku,
        product_row.mirror_name,
        product_row.units_per_pack,
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
        units_per_pack = product_row.units_per_pack,
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
