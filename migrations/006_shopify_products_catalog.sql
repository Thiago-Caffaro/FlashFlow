-- Catálogo real de produtos/variantes do Shopify, sincronizado via Admin REST
-- API junto com pedidos/carrinhos (syncShopifyData). Cada linha é uma
-- variante (mesma granularidade de fulfillment_products, que é por SKU).
--
-- source='manual' cobre entradas digitadas nesta mesma tabela/tela para SKUs
-- que a loja real não tem cadastrado.
--
-- `hidden` marca uma linha "excluída" localmente — a própria loja Shopify
-- NUNCA é alterada (só temos escopo read_products); syncs futuros devem
-- preservar hidden=true e não podem reverter (ver lib/shopify-products-service.ts).
--
-- `keep_local_copy` é o toggle de "cópia local": quando true, o sync mantém
-- uma linha espelhada em fulfillment_products (linkada via local_product_id)
-- atualizada automaticamente. fulfillment_products não ganha nenhuma coluna
-- nova — a relação é 1:1 vista a partir daqui.

CREATE TABLE IF NOT EXISTS shopify_products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_integration_id UUID REFERENCES shopify_integrations(id) ON DELETE SET NULL,
  shopify_product_id TEXT,
  shopify_variant_id TEXT,
  sku TEXT,
  title TEXT NOT NULL,
  variant_title TEXT,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  image_url TEXT,
  source TEXT NOT NULL DEFAULT 'shopify' CHECK (source IN ('shopify', 'manual')),
  hidden BOOLEAN NOT NULL DEFAULT false,
  keep_local_copy BOOLEAN NOT NULL DEFAULT false,
  local_product_id UUID REFERENCES fulfillment_products(id) ON DELETE SET NULL,
  raw_shopify_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma variante real por integração aparece uma única vez (usado como conflict
-- target no upsert do sync). Índice NÃO é parcial de propósito: um upsert via
-- ON CONFLICT precisa de um índice não-parcial (ou um cujo predicado seja
-- repetido na cláusula ON CONFLICT, que o cliente supabase-js não expõe) para
-- ser usado como alvo de inferência de conflito. Isso não é um problema para
-- linhas source='manual' (shopify_variant_id NULL): o Postgres nunca trata
-- NULL como igual a NULL em um índice único, então múltiplas linhas manuais
-- nunca colidem entre si nem com linhas reais.
CREATE UNIQUE INDEX IF NOT EXISTS shopify_products_variant_unique_idx
  ON shopify_products(shopify_integration_id, shopify_variant_id);

-- Garante que uma linha de fulfillment_products só é espelho de uma linha daqui.
CREATE UNIQUE INDEX IF NOT EXISTS shopify_products_local_product_unique_idx
  ON shopify_products(local_product_id)
  WHERE local_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS shopify_products_integration_idx
  ON shopify_products(shopify_integration_id, hidden);

CREATE INDEX IF NOT EXISTS shopify_products_keep_local_copy_idx
  ON shopify_products(keep_local_copy) WHERE keep_local_copy = true;
