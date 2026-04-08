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

## [003] Sem autenticação no MVP semana 1
**Decisão**: sem auth na primeira semana  
**Motivo**: não bloqueia validação do core  
**Revisão**: Supabase Auth após MVP funcionar

---

## [004] Evolution API self-hosted no TrueNAS
**Decisão**: Evolution API v2.2.3 no TrueNAS Scale via Docker  
**Acesso**: Tailscale — IP fixo privado 100.119.152.43  
**Risco**: banimento do número WhatsApp  
**Mitigação**: rate limit, delays humanizados  
**Fase 2**: migrar para WhatsApp Cloud API oficial

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

## [007] Gemini — Fase 3
**Status**: não implementado  
**Modelo**: Gemini 2.5 Flash-Lite (primário) + Flash (fallback)

---

## [008] Flow Builder — Fase 2
**Status**: não implementado  
**Lib**: xyflow, fluxo salvo como JSONB no Supabase
