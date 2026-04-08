# Decisões Técnicas (ADR simplificado)

Registro das decisões importantes para não reabrir discussões resolvidas.

---

## [001] Monorepo com pnpm workspaces
**Decisão**: usar monorepo  
**Motivo**: compartilhar tipos TypeScript entre frontend e backend sem duplicação  
**Alternativa descartada**: repositórios separados (sincronização de tipos manual = dor de cabeça)

---

## [002] NestJS no backend (não FastAPI)
**Decisão**: NestJS  
**Motivo**: TypeScript end-to-end, decorators familiares, excelente integração com Socket.io e Prisma  
**Alternativa descartada**: FastAPI Python (team é mais forte em JS/TS)

---

## [003] Evolution API (não WhatsApp Cloud API)
**Decisão**: Evolution API no MVP  
**Motivo**: sem aprovação Meta, sem custo por mensagem, QR code imediato  
**Risco assumido**: possibilidade de banimento do número  
**Mitigação**: rate limit (máx 30 msg/min), delays humanizados, proxy  
**Plano**: migrar para Cloud API oficial na Fase 2

---

## [004] Gemini (não OpenAI)
**Decisão**: Google Gemini 2.5  
**Motivo**: custo ~10x menor que GPT-4, context caching nativo, Flash-Lite para casos simples  
**Alternativa**: GPT-4o (mais caro, sem context caching eficiente)

---

## [005] Estado da conversa no Redis (não só no Postgres)
**Decisão**: Redis como estado primário, Postgres como histórico  
**Motivo**: latência < 5ms para leitura de estado, TTL nativo  
**Trade-off**: se Redis cair, perda de estado de conversas ativas  
**Mitigação**: backup periódico do estado no Postgres (a cada 5 min)

---

## [006] Structured Output obrigatório no Gemini
**Decisão**: toda chamada ao Gemini retorna JSON validado com Zod  
**Motivo**: evitar parsing de texto livre, garantir que a IA sempre retorne `action` correta  
**Alternativa descartada**: parsing de texto livre (frágil demais)

---

## [007] Clerk para autenticação (não NextAuth)
**Decisão**: Clerk  
**Motivo**: multi-tenant (organizations) pronto, webhook de eventos, UI components  
**Custo**: free tier suficiente para MVP, ~$25/mês em escala

---

## [008] JSONB no Postgres para fluxos (não tabela relacional de nodes)
**Decisão**: fluxo salvo como JSON único no campo `data`  
**Motivo**: schema do xyflow muda com frequência, JSONB é flexível e indexável  
**Trade-off**: queries analíticas dentro do fluxo são mais complexas  
**Mitigação**: analytics em tabela separada (`analytics_events`), nunca em cima do JSONB
