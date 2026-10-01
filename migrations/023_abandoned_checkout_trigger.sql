-- 023_abandoned_checkout_trigger.sql
-- Gatilho "Carrinho abandonado": um checkout Shopify novo enfileira um
-- flow_job agendado para (última atividade do checkout + delay do gatilho).
-- O worker confere de novo, na hora de rodar, se o carrinho não virou
-- pedido — nunca manda "você esqueceu seu carrinho" para quem já comprou.

ALTER TABLE public.flow_jobs
  DROP CONSTRAINT IF EXISTS flow_jobs_job_type_check;
ALTER TABLE public.flow_jobs
  ADD CONSTRAINT flow_jobs_job_type_check
  CHECK (job_type IN (
    'shopify_order_flow',
    'flow_message_resume',
    'delivery_status_flow',
    'abandoned_checkout_flow'
  ));

-- order_id é FK para fulfillment_orders; um checkout abandonado não é pedido,
-- então ganha sua própria referência.
ALTER TABLE public.flow_jobs
  ADD COLUMN IF NOT EXISTS checkout_id uuid
    REFERENCES public.shopify_abandoned_checkouts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS flow_jobs_checkout_pending_idx
  ON public.flow_jobs (checkout_id)
  WHERE checkout_id IS NOT NULL AND status = 'pending';

-- completed_at do payload Shopify: preenchido quando o checkout vira pedido.
ALTER TABLE public.shopify_abandoned_checkouts
  ADD COLUMN IF NOT EXISTS shopify_completed_at timestamptz;

-- Conversão: o pedido traz checkout_token/checkout_id do checkout de origem.
CREATE INDEX IF NOT EXISTS shopify_abandoned_checkouts_token_idx
  ON public.shopify_abandoned_checkouts (shopify_integration_id, checkout_token)
  WHERE checkout_token IS NOT NULL;
