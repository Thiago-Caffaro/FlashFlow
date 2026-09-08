# Decisões Técnicas

Registro das decisões para não reabrir discussões resolvidas.

---

## [001] Next.js full-stack (sem backend separado)
**Decisão**: tudo em Next.js 15 App Router — frontend + API Routes  
**Motivo**: solo dev, menos infraestrutura, deploy simples  
**Descartado**: NestJS separado — overhead desnecessário no MVP  

---

## [002] Supabase (não PostgreSQL self-hosted)
**Decisão**: Supabase como banco gerenciado  
**Motivo**: PostgreSQL gerenciado grátis, Realtime nativo, zero infra  
**Descartado**: PostgreSQL + Redis local  
**ORM**: nenhum — supabase-js direto

---

## [003] Sem autenticação no MVP semana 1 — SUPERADA por [009]
**Decisão original**: sem auth na primeira semana  
**Motivo**: não bloqueia validação do core  
**Revisão prevista**: Supabase Auth após MVP funcionar  
**O que realmente aconteceu**: implementada em 2026-06-26 (`3361b5e`), mas
**não** com Supabase Auth — ver [009].

---

## [004] Evolution API self-hosted no TrueNAS
**Decisão**: Evolution API v2.2.3 no TrueNAS Scale via Docker  
**Acesso**: Tailscale — IP fixo privado (ver `.env.local`)  
**Risco**: banimento do número WhatsApp  
**Mitigação**: rate limit, delays humanizados — mesmo assim, um número já
foi banido por mass-send em 2026-07-28 por um bug de disparo em rajada na
integração Shopify (corrigido no mesmo dia; ver histórico de memória do
projeto)  
**Fase 2 (concluída)**: WhatsApp Cloud API oficial adicionada como segundo
provedor **em paralelo** ao Evolution — não substituiu, ver [010]

---

## [005] Supabase Realtime (não Socket.io)
**Decisão**: Supabase Realtime para tempo real  
**Motivo**: incluso no Supabase, zero config extra  
**Descartado**: Socket.io — requer servidor dedicado

---

## [006] Upstash Redis
**Decisão**: Upstash Redis grátis  
**Motivo**: Evolution API v2.2.3 requer Redis  
**Uso**: exclusivo para Evolution API internamente

---

## [007] IA no flow builder — SUPERADA por [011]
**Status original**: não implementado, planejado só Gemini 2.5 Flash-Lite
(primário) + Flash (fallback)  
**O que realmente aconteceu**: implementado com suporte a três provedores
(Gemini, OpenAI, OpenRouter), configurável por node — ver [011].

---

## [008] Flow Builder — Fase 2 — CONCLUÍDA
**Decisão**: xyflow, fluxo salvo como JSONB no Supabase (coluna `json` em
`flows`)  
**Status**: implementado — motor de execução próprio em
`lib/flow-engine.ts`, com fila assíncrona (`flow_jobs`) para casos que
não podem rodar síncrono no webhook (pedido Shopify ainda não
sincronizado, disparo por evento externo). Detalhes em `docs/FLOWS.md` e
`PROJECT_CONTEXT.md`.

---

## [009] Auth administrativa própria, não Supabase Auth
**Decisão**: sessão única de administrador via cookie HMAC assinado
(`ff_auth`), sem tabela de sessões — revogar todas as sessões ativas é
rotacionar `AUTH_SECRET` (invalida a assinatura de qualquer token
emitido antes)  
**Motivo**: o produto não é multi-usuário por cliente final — é um único
operador (ou pequena equipe) administrando várias contas/instâncias de
WhatsApp. Supabase Auth (multi-usuário, RLS por `auth.uid()`) resolveria
um problema que o produto não tem.  
**Isolamento real**: por `instance_name` (conta WhatsApp), não por
usuário — reforçado por `lib/instance-guard.ts` e testes dedicados de
isolamento em `__tests__/api/*-isolation.test.ts`  
**Implementado em**: 2026-06-26 (`3361b5e`)  
**Descartado**: Supabase Auth — como não há necessidade de múltiplos
usuários/papéis, adicionaria complexidade sem resolver um problema real

---

## [010] WhatsApp Cloud API como segundo provedor, não substituição
**Decisão**: suportar Evolution API e WhatsApp Cloud API **em paralelo**,
escolhido por conta (`accounts.provider`), não migrar todas as contas de
uma vez  
**Motivo**: a Cloud API oficial é mais estável e sem risco de ban, mas
tem restrições que a Evolution não tem (janela de resposta de 24h,
templates aprovados pela Meta) — permitir escolher por conta deixa o
operador migrar gradualmente sem perder as contas já configuradas na
Evolution  
**Implementado em**: 2026-08-12 a 2026-08-27, em 4 fases incrementais
(conexão → mídia → botões interativos → templates e janela de 24h)  
**Consequência de design**: a janela de 24h só é aplicada quando
`provider==='cloud_api'` (`lib/flow-engine.ts:1509`) — contas Evolution
nunca são bloqueadas por ela, porque a restrição vem da Meta, não do
produto

---

## [011] IA multi-provider, não só Gemini
**Decisão**: node `aiAssistant` do flow builder suporta Gemini, OpenAI e
OpenRouter, escolhido por node, com fallback de modelo padrão por
provedor  
**Motivo**: não documentado explicitamente no histórico de commits —
provavelmente flexibilidade de custo/qualidade por caso de uso  
**Segurança**: credenciais de cada provedor cifradas em repouso
(AES-256-GCM, `lib/ai-crypto.ts`), nunca em texto plano
