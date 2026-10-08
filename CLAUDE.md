# FlashFlow — Contexto para Claude Code

## O que é este projeto

SaaS de atendimento e automação de WhatsApp para um operador de
e-commerce com fulfillment contra-reembolso (COD) na Europa: chat de
atendimento multi-conta, construtor visual de fluxos de conversa (com
blocos de IA), integração com Shopify e com um fulfillment externo
(FenixCOD) para envio físico e cobrança na entrega.

O projeto já passou do MVP inicial (abril/2026) — está em produção,
versionado (`lib/version.ts`, `APP_VERSION`) e evoluindo continuamente.
**Para o estado técnico e de regras de negócio atual, a fonte confiável
é [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)** (gerado pela skill global
`explore-project`, com fluxos críticos citados por `arquivo:linha`) —
regenere-o após mudanças estruturais relevantes em vez de manter esse
conhecimento duplicado aqui. Este arquivo (`CLAUDE.md`) trata de
**convenções de como escrever código neste repositório**, que mudam bem
menos que o produto em si. Para regras de desenvolvimento/verificação
compartilhadas entre agentes (não só Claude), veja também
[`AGENTS.md`](AGENTS.md).

## Stack real

- **Frontend + Backend**: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + shadcn/ui — tudo num único app Next.js, sem backend separado
- **Banco**: Supabase (PostgreSQL + Realtime), sem ORM — `@supabase/supabase-js` direto
- **Auth**: sessão administrativa única via cookie HMAC (`lib/server-auth.ts`), não é Supabase Auth — ver `proxy.ts` para o gate global de `/api/:path*`
- **WhatsApp**: dual — Evolution API (self-hosted) **e** WhatsApp Cloud API (oficial, Meta), lado a lado por conta (`accounts.provider`)
- **IA**: multi-provider — Gemini, OpenAI e OpenRouter (não só Gemini), configurável por node do flow builder
- **Flow Builder**: `@xyflow/react`, com motor de execução próprio (`lib/flow-engine.ts`) — já implementado, não é mais item de roadmap
- **Fulfillment**: integração com Shopify (pedidos, catálogo, checkout abandonado) e com a API externa European Fulfillment/FenixCOD (contrato documentado em `docs/FULFILLMENT_API.md`)

## Infraestrutura

- Evolution API self-hosted no TrueNAS via Tailscale — endereço e instância reais ficam em `.env.local`/`.env.development.local` (não versionados), não neste arquivo
- WhatsApp Cloud API: credenciais por conta, armazenadas cifradas (AES-256-GCM, `lib/ai-crypto.ts`) via painel — não em env var
- Deploy: Docker → GHCR; push em `main` publica `:latest`+`:test`, outras branches publicam só `:test` (`.github/workflows/`)

## Estrutura de pastas (visão de alto nível)

```
app/
  api/            Toda lógica de banco/integração vive aqui — nunca no componente
    webhook/      Rotas públicas server-a-servidor (Evolution, WhatsApp Cloud, Shopify, interatividade do Slack) — únicas fora do gate de auth em proxy.ts
    flows/        CRUD de fluxos
    accounts/     Contas/instâncias WhatsApp (QR, pairing, reconexão)
    shopify/, fulfillment/   Integrações de e-commerce e envio
    integrations/ Slack (conexão, canais, encaminhamentos por conta) — guia em docs/SLACK.md
    ai-keys/, ai-sessions/, memory-blocks/   Config e estado de IA
  fulfillment/, order-preview/, catalog-preview/, diagnostics/   Rotas de UI fora do chat principal
components/
  ui/             shadcn — não editar
  chat/, chats/   Interface de atendimento
  flows/, flows/nodes/   Editor visual de fluxo — um arquivo por tipo de node
  fulfillment/, auth/, sidebar-right/, memory/, gallery/, notifications/, ai-sessions/, nav/
contexts/         Estado client-side global (account, auth, theme)
lib/              Um módulo por domínio/integração — nome do arquivo já indica a camada (shopify-*.ts, fulfillment-*.ts, whatsapp-cloud-*.ts, flow-*.ts...)
types/index.ts     Único arquivo de tipos do projeto — fonte de verdade do modelo de dados
migrations/       SQL numerado (NNN_descricao.sql) — não é o schema completo; tabelas fundacionais são anteriores a este diretório
docs/             Documentação de referência (arquitetura, API, banco, fluxos, decisões técnicas)
__tests__/        Jest — api/, lib/, components/, incluindo testes de isolamento por instância
```

Para o mapa completo com o *porquê* de cada pasta, veja a seção
"Estrutura de pastas" do `PROJECT_CONTEXT.md`.

### Regras de componentes
- 1 componente por arquivo
- Nome do arquivo = nome do componente em kebab-case
- Componentes client-side: adicionar `'use client'` no topo
- Componentes server-side: sem diretiva (padrão no App Router)
- Props sempre tipadas com interface explícita

### Regras de API Routes
- Toda lógica de banco fica na route ou em `lib/`, não no componente
- Sempre usar `supabaseAdmin` (service role, `lib/supabase-admin.ts`) nas API routes
- Nunca expor `SUPABASE_SERVICE_ROLE_KEY` ou outros segredos de servidor no client-side
- Toda rota que recebe um `id` de recurso deve validar posse via `lib/instance-guard.ts` (`belongsToInstance`) antes de agir sobre ele — nunca confiar em `instance_name` vindo do client (a maioria das tabelas é particionada por instância WhatsApp, não por usuário)
- Retornar sempre `{ ok: true/false }` + dados ou erro

### Nomenclatura
- Arquivos: kebab-case (`conversation-list.tsx`)
- Componentes: PascalCase (`ConversationList`)
- Funções: camelCase (`fetchConversations`)
- Tipos/Interfaces: PascalCase (`Conversation`, `Message`)
- Constantes: UPPER_SNAKE_CASE (`EVOLUTION_API_URL`)

### Estilo
- Tailwind para tudo — sem CSS modules, sem styled-components
- shadcn/ui para componentes base
- Tema escuro como padrão (fundo `#111b21` estilo WhatsApp)
- Mobile-first

## Variáveis de ambiente

Lista completa e atual das chaves realmente lidas via `process.env` no
código (valores reais ficam em `.env.local`/`.env.development.local`,
nunca neste arquivo):

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_URL=

# Auth administrativa
ADMIN_USERNAME=
ADMIN_PASSWORD=
AUTH_SECRET=          # rotacionar revoga todas as sessões ativas
COOKIE_SECURE=

# Evolution API
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_WEBHOOK_SECRET=
EVOLUTION_REPLY_BUTTONS_ENABLED=
EVOLUTION_SOCKET_ENABLED=   # opt-in; Evolution v2.3.7 não expõe Socket.IO por padrão

# WhatsApp Cloud API
WHATSAPP_CLOUD_API_VERSION=
WHATSAPP_CLOUD_APP_SECRET=
WHATSAPP_CLOUD_VERIFY_TOKEN=

# Shopify
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_SCOPES=
SHOPIFY_ADMIN_API_VERSION=

# IA
AI_ENCRYPTION_KEY=    # cifra chaves de provedor de IA em repouso (AES-256-GCM)

# Infra
APP_BASE_URL=
WEBHOOK_BASE_URL=

# Feature flags (client-side)
NEXT_PUBLIC_FEATURE_GALLERY=
NEXT_PUBLIC_FEATURE_AI_SESSIONS=
NEXT_PUBLIC_FEATURE_SWITCH_CASE=
```

Credenciais por conta/integração (Shopify shop secret, bot token e signing secret do Slack, credenciais
FenixCOD, chaves de provedor de IA) **não** são env vars — são
configuradas pelo painel web e guardadas cifradas no Supabase
(`app_settings`, `ai_provider_keys`). Ver `lib/app-settings.ts` e
`lib/ai-crypto.ts`.

## Schema do banco

Não duplicado aqui — o schema tem dezenas de tabelas hoje. Fonte de
verdade: `types/index.ts` (tipos TypeScript de cada tabela) e
`docs/DATABASE.md`. `migrations/*.sql` mostra a evolução incremental a
partir da migration `001`, mas **não** contém os `CREATE TABLE`
originais das tabelas fundacionais (`conversations`, `messages`,
`accounts`, `flows`, `triggers`, `ai_sessions` e outras) — elas
existiam antes do diretório `migrations/` ser criado.

## Fase atual

Não há mais um "escopo MVP" único — o produto está em produção e evolui
por feature. Antes de assumir que algo "ainda não foi implementado",
verifique o código (ou `PROJECT_CONTEXT.md`) em vez de confiar em uma
fase antiga documentada em algum lugar.

## Princípios

1. TypeScript — sem `any`
2. Tratar erros explicitamente
3. Tudo em Next.js App Router — sem backend separado
4. Trate código, migrations e testes atuais como autoridade quando
   documentação mais antiga divergir deles
