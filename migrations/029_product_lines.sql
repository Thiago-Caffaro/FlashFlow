-- 029_product_lines.sql
-- Linhas de produto (EMA, REJU, MEMO, VISTA) e seus produtos, base das
-- automações simples (aba "Automações"): uma automação casa com
-- plataforma + país + linha, e a linha de um carrinho/pedido vem dos
-- produtos que ele contém.
--
-- Cada loja (um país = uma loja Shopify ou conta Lightfunnels) tem seus
-- próprios IDs de produto, então o vínculo produto → catálogo é explícito e
-- feito por loja em product_catalog_links. Um produto do catálogo pertence a
-- no máximo um produto de linha.

CREATE TABLE IF NOT EXISTS public.product_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  -- Menor = mais prioritária. Decide a linha de um carrinho com produtos de
  -- linhas diferentes.
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_lines_code_key
  ON public.product_lines (upper(code));

ALTER TABLE public.product_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_lines FROM anon, authenticated;
GRANT ALL ON TABLE public.product_lines TO service_role;

CREATE TABLE IF NOT EXISTS public.line_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_line_id uuid NOT NULL REFERENCES public.product_lines(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS line_products_name_key
  ON public.line_products (upper(name));
CREATE INDEX IF NOT EXISTS line_products_line_idx
  ON public.line_products (product_line_id);

ALTER TABLE public.line_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.line_products FROM anon, authenticated;
GRANT ALL ON TABLE public.line_products TO service_role;

CREATE TABLE IF NOT EXISTS public.product_catalog_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_product_id uuid NOT NULL REFERENCES public.line_products(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('shopify', 'lightfunnels')),
  -- shopify_integrations.id ou lightfunnels_integrations.id, conforme platform
  -- (polimórfico, por isso sem FK).
  integration_id uuid NOT NULL,
  -- ID do produto na plataforma (não da variante): shopify_product_id /
  -- lf_product_id, o mesmo que vem nos line_items do carrinho.
  external_product_id text NOT NULL,
  -- Título no momento do vínculo, só para exibição.
  title text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_catalog_links_external_key
  ON public.product_catalog_links (platform, integration_id, external_product_id);
CREATE INDEX IF NOT EXISTS product_catalog_links_product_idx
  ON public.product_catalog_links (line_product_id);

ALTER TABLE public.product_catalog_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_catalog_links FROM anon, authenticated;
GRANT ALL ON TABLE public.product_catalog_links TO service_role;

-- Linhas e produtos iniciais (ordem de prioridade combinada com a operação).
INSERT INTO public.product_lines (code, name, priority) VALUES
  ('EMA', 'EMA', 10),
  ('REJU', 'REJU', 20),
  ('MEMO', 'MEMO', 30),
  ('VISTA', 'VISTA', 40)
ON CONFLICT DO NOTHING;

INSERT INTO public.line_products (product_line_id, name)
SELECT line.id, seed.name
FROM (VALUES
  ('EMA', 'LIPOGAN'),
  ('REJU', 'REJUVIA'),
  ('MEMO', 'NEURATINE'),
  ('VISTA', 'VISTA PLUS')
) AS seed(code, name)
JOIN public.product_lines line ON upper(line.code) = seed.code
ON CONFLICT DO NOTHING;
