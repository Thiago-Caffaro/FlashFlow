-- 031_automation_kinds.sql
-- Automações simples além do carrinho abandonado: pedido criado, mudança de
-- status de entrega e resposta por palavra-chave (os mesmos eventos dos
-- Gatilhos). Aplicar depois da 030.
--
-- - plataforma e país passam a ser opcionais: a palavra-chave responde
--   qualquer mensagem do número, sem pedido por trás;
-- - config guarda o que é próprio de cada modelo (estados de entrega,
--   palavras-chave);
-- - espera 0 = envia na hora (pedido, entrega, palavra-chave);
-- - a chave única por modelo + plataforma + país + linha vale só para
--   carrinho e pedido criado — entrega e palavra-chave podem ter várias
--   automações no mesmo escopo (estados ou palavras diferentes).

ALTER TABLE public.automations DROP CONSTRAINT IF EXISTS automations_kind_check;
ALTER TABLE public.automations
  ADD CONSTRAINT automations_kind_check
  CHECK (kind IN ('abandoned_cart', 'order_created', 'delivery_status', 'message_keyword'));

ALTER TABLE public.automations ALTER COLUMN platform DROP NOT NULL;
ALTER TABLE public.automations ALTER COLUMN country DROP NOT NULL;
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

DROP INDEX IF EXISTS public.automations_scope_key;
CREATE UNIQUE INDEX IF NOT EXISTS automations_scope_key
  ON public.automations (
    kind,
    platform,
    upper(country),
    coalesce(product_line_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE kind IN ('abandoned_cart', 'order_created');

ALTER TABLE public.automation_steps DROP CONSTRAINT IF EXISTS automation_steps_delay_minutes_check;
ALTER TABLE public.automation_steps
  ADD CONSTRAINT automation_steps_delay_minutes_check
  CHECK (delay_minutes BETWEEN 0 AND 10080);
