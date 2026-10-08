-- 025_close_anon_access.sql
--
-- Achado (2026-10-08, replicado num Supabase local com o schema de produção):
-- a migration 008 habilitou RLS, mas policies antigas de leitura anônima
-- continuaram existindo — e RLS + policy "USING (true)" para anon = leitura
-- liberada. Com a chave anônima (pública, embutida no JavaScript do app),
-- o PostgREST devolvia conversas, mensagens e sessões de IA completas.
--
-- Além disso, as funções SECURITY DEFINER rodam como dono (ignoram RLS) e o
-- Postgres concede EXECUTE a PUBLIC por padrão — as migrations anteriores
-- não revogaram de PUBLIC. Pela chave anônima dava para chamar
-- /rest/v1/rpc/claim_flow_jobs (travar a fila), apply_fulfillment_delivery_status
-- (mudar status de entrega e enfileirar fluxo que manda WhatsApp ao cliente) etc.
--
-- O navegador não lê nada do Supabase direto (tudo passa pelas API routes
-- com a service role, que ignora RLS e mantém os grants explícitos abaixo),
-- então nada no app depende do acesso removido aqui.
--
-- Verificação depois de aplicar (somente leitura, com a anon key):
--   GET  /rest/v1/messages?select=id&limit=1        → 200 "[]"
--   POST /rest/v1/rpc/claim_flow_jobs {"p_worker_id":"x"} → 401/403 permission denied

DROP POLICY IF EXISTS "anon can read conversations" ON public.conversations;
DROP POLICY IF EXISTS "anon can read messages" ON public.messages;
DROP POLICY IF EXISTS "anon_read_messages" ON public.messages;
DROP POLICY IF EXISTS "anon_read_ai_sessions" ON public.ai_sessions;
DROP POLICY IF EXISTS "allow_anon_read_ai_sessions" ON public.ai_sessions;

REVOKE ALL ON TABLE
  public.conversations,
  public.messages,
  public.ai_sessions,
  public.agent_memory_blocks,
  public.flow_media,
  public.instance_ai_config
FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.apply_fulfillment_delivery_status(uuid, text, text, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_flow_jobs(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_fulfillment_delivery_sync(text, integer, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_fulfillment_delivery_status(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_flow_send_slot(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_shopify_products_local_copy(uuid[], boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_fulfillment_delivery_status(uuid, text, text, text, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_flow_jobs(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_fulfillment_delivery_sync(text, integer, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_fulfillment_delivery_status(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_flow_send_slot(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_shopify_products_local_copy(uuid[], boolean) TO service_role;

-- Funções criadas no futuro em public não nascem executáveis por anon.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
