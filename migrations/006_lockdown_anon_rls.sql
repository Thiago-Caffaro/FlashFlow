-- 006_lockdown_anon_rls.sql
--
-- Achado: nenhuma tabela usada pelo FlashFlow tinha Row Level Security
-- habilitado. A chave anônima do Supabase (NEXT_PUBLIC_SUPABASE_ANON_KEY),
-- que é pública por design (embutida em todo carregamento do app no
-- navegador), conseguia ler diretamente TODAS as linhas de todas as tabelas
-- via REST API do PostgREST — confirmado em produção de forma somente-leitura
-- durante a auditoria (conversations, messages, ai_sessions, accounts,
-- app_settings, ai_provider_keys, flows, triggers, fulfillment_*,
-- shopify_*, flow_media, e as tabelas internas da Evolution API "Contact",
-- "Chat", "Instance", "Message", "IsOnWhatsapp").
--
-- FlashFlow não usa Supabase Auth (não existem usuários reais em auth.users;
-- a sessão administrativa é um cookie HMAC próprio — ver lib/server-auth.ts).
-- Por isso a correção não cria policies "por usuário": ela nega totalmente o
-- acesso dos papéis "anon" e "authenticated" a estas tabelas. Toda leitura e
-- escrita passa a acontecer exclusivamente pelas API routes do Next.js
-- (app/api/**/route.ts), que usam SUPABASE_SERVICE_ROLE_KEY — e a service
-- role sempre ignora RLS, então nada muda para o backend.
--
-- Pré-requisito: o frontend já foi alterado (mesma mudança) para não fazer
-- mais `supabase.from(...)` nem `supabase.channel(...).on('postgres_changes')`
-- direto do navegador — ver components/chats/chats-tab.tsx,
-- components/chat/chat-window.tsx, components/ai-sessions/*.tsx,
-- components/memory/analyze-conversations-dialog.tsx e app/page.tsx.
--
-- ESTRATÉGIA DE APLICAÇÃO (ordem obrigatória):
--   1. Deploy do código desta mudança (frontend + as novas rotas
--      GET /api/conversations) PRIMEIRO, e confirmar em produção que a UI
--      segue funcionando (ela já teria parado de depender de leitura
--      anônima, mas a tabela ainda estaria acessível — sem regressão).
--   2. Só então aplicar esta migration no SQL editor do Supabase (Dashboard
--      > SQL Editor) ou via `supabase db push` / psql com a service role.
--      Aplicar esta migration ANTES do passo 1 quebraria a UI para qualquer
--      usuário que ainda esteja com o bundle antigo em cache.
--   3. Depois de aplicada, repetir a checagem somente-leitura desta
--      auditoria (GET .../rest/v1/conversations?select=id&limit=1 com a
--      anon key) e confirmar que retorna 200 com corpo "[]" (RLS ativo,
--      sem policy = nega tudo, mas PostgREST ainda responde 200/lista vazia
--      para SELECT — não 401/403).
--
-- ROLLBACK: os comandos DISABLE abaixo revertem imediatamente ao estado
-- anterior (acesso anônimo total). Rollback não é recomendado — reabre a
-- exposição confirmada nesta auditoria — mas está documentado por exigência
-- do processo. Só use em caso de regressão bloqueante e sem alternativa.

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE instance_ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_abandoned_checkouts ENABLE ROW LEVEL SECURITY;

-- Tabelas internas da Evolution API (schema Prisma, nomes capitalizados).
-- A própria Evolution API acessa o Postgres com uma role/connection string
-- direta (DATABASE_URL / DATABASE_CONNECTION_URI no docker-compose), não com
-- os papéis "anon"/"authenticated" do PostgREST — travar RLS aqui não afeta
-- o funcionamento da Evolution API, só impede leitura via REST anônima.
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Chat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Instance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IsOnWhatsapp" ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy é criada de propósito: com RLS habilitado e nenhuma policy,
-- Postgres nega todas as linhas para qualquer role que não seja o dono da
-- tabela ou BYPASSRLS (a service role do Supabase tem BYPASSRLS).

-- ROLLBACK (não recomendado — ver aviso acima):
-- ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE ai_sessions DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE agent_memory_blocks DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE ai_provider_keys DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE flows DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE flow_runs DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE flow_media DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE triggers DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE app_settings DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE instance_ai_config DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE fulfillment_integrations DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE fulfillment_products DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE fulfillment_orders DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE fulfillment_order_events DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE shopify_integrations DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE shopify_abandoned_checkouts DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "Contact" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "Chat" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "Instance" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "Message" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "IsOnWhatsapp" DISABLE ROW LEVEL SECURITY;
