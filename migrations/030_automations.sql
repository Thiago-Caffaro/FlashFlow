-- 030_automations.sql
-- Automações simples (aba "Automações"): criadas a partir de um modelo
-- pronto, sem montar fluxo. Uma automação casa com plataforma + país + linha
-- de produto (linha vazia = qualquer linha) e envia pelo número escolhido
-- nela — não pelo roteamento de conta do pedido/carrinho.
--
-- Cada etapa (até 3 lembretes) gera e mantém um fluxo de um envio
-- (início → enviar mensagem), marcado em flows.managed_by_automation_id e
-- escondido da lista de Fluxos. Assim a execução reaproveita o motor de
-- fluxo e a fila flow_jobs (que exige flow_id). Apagar a automação apaga as
-- etapas, os fluxos gerados e, pelo ON DELETE CASCADE de flow_jobs.flow_id,
-- os jobs pendentes.

CREATE TABLE IF NOT EXISTS public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('abandoned_cart')),
  platform text NOT NULL CHECK (platform IN ('shopify', 'lightfunnels')),
  country text NOT NULL,
  -- RESTRICT: apagar uma linha em uso não pode transformar a automação em
  -- "qualquer linha" (SET NULL) nem sumir com ela em silêncio (CASCADE).
  product_line_id uuid REFERENCES public.product_lines(id) ON DELETE RESTRICT,
  instance_name text NOT NULL,
  -- Nasce desligada: envio automático para fora só depois de ativação manual.
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Uma automação por modelo + plataforma + país + linha (linha vazia conta
-- como um valor próprio).
CREATE UNIQUE INDEX IF NOT EXISTS automations_scope_key
  ON public.automations (
    kind,
    platform,
    upper(country),
    coalesce(product_line_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automations FROM anon, authenticated;
GRANT ALL ON TABLE public.automations TO service_role;

CREATE TABLE IF NOT EXISTS public.automation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 3),
  -- Carrinho: minutos sem atividade do cliente antes do envio (até 7 dias).
  delay_minutes integer NOT NULL CHECK (delay_minutes BETWEEN 1 AND 10080),
  message text NOT NULL DEFAULT '',
  -- Template aprovado usado quando a janela de 24h está fechada (conta
  -- Cloud API). Obrigatório para conta Cloud API — validado na aplicação.
  fallback_template_id uuid REFERENCES public.whatsapp_message_templates(id) ON DELETE SET NULL,
  fallback_template_variable_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  flow_id uuid REFERENCES public.flows(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id, position)
);

ALTER TABLE public.automation_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_steps FROM anon, authenticated;
GRANT ALL ON TABLE public.automation_steps TO service_role;

ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS managed_by_automation_id uuid
    REFERENCES public.automations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS flows_managed_by_automation_idx
  ON public.flows (managed_by_automation_id)
  WHERE managed_by_automation_id IS NOT NULL;
