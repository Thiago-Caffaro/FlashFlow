# Descrição do Projeto - FlashFlow

> Atualizado em 2026-09-08. Para o estado técnico e de regras de negócio
> verificado contra o código, veja `PROJECT_CONTEXT.md` na raiz do repo
> e `docs/`.

## Introdução

FlashFlow é uma plataforma SaaS para criação e gerenciamento de fluxos
de conversa automatizados no WhatsApp, com IA integrada, voltada para um
operador de e-commerce com fulfillment contra-reembolso (COD) na
Europa. Além da automação, o sistema cobre atendimento manual, gestão de
pedidos (Shopify) e envio físico via um fulfillment externo (FenixCOD).

O sistema foi projetado para substituir ferramentas terceiras como o
BotConversa, oferecendo maior controle, redução de custos e alta
customização conforme as necessidades específicas do negócio.

## Problema que Resolve

- Alto custo das plataformas existentes
- Pouca flexibilidade para criar fluxos complexos por produto
- Dificuldade de integração com múltiplos números e países
- Dependência total da ferramenta externa

## O que já existe

- **Construtor Visual de Fluxos**: editor drag-and-drop (`@xyflow/react`)
  com motor de execução próprio — blocos de mensagem, condição,
  switch-case, IA, captura de estado de pedido e notificação interna.
- **WhatsApp dual**: Evolution API (self-hosted) e WhatsApp Cloud API
  (oficial, Meta) lado a lado, escolhido por conta/número.
- **IA multi-provider**: Gemini, OpenAI e OpenRouter, configurável por
  bloco do fluxo, com sessões contínuas, memória de contexto e
  escalação para atendimento humano.
- **Interface de Atendimento**: réplica da experiência do WhatsApp Web
  para atendentes humanos, com controle de sessões de IA em paralelo.
- **Integração Shopify**: pedidos, catálogo de produtos, checkout
  abandonado (com recuperação via WhatsApp, incluindo template aprovado
  para fora da janela de 24h da Cloud API).
- **Fulfillment (FenixCOD)**: fila de confirmação, sandbox de testes,
  submissão de pedidos, sincronização de status de entrega, timeline por
  pedido — cobrindo ~17 países europeus mapeados hoje.
- **Autenticação administrativa** própria (não Supabase Auth) e
  particionamento de dados por conta/instância WhatsApp, com testes
  dedicados de isolamento.

Detalhes verificados (com citação de arquivo:linha) de cada um desses
fluxos estão em `PROJECT_CONTEXT.md`.

## Tecnologias Principais

- **Frontend + Backend**: Next.js 16 (App Router) + React 19 + TypeScript — tudo num único app, sem backend separado
- **Estilo**: Tailwind CSS v4 + shadcn/ui
- **Banco**: Supabase (PostgreSQL + Realtime), sem ORM
- **WhatsApp**: Evolution API (self-hosted) e WhatsApp Cloud API (oficial), dual
- **IA**: Gemini, OpenAI e OpenRouter (multi-provider, não só Gemini)
- **Fulfillment**: European Fulfillment / FenixCOD (contrato em `docs/FULFILLMENT_API.md`)
- **E-commerce**: Shopify (OAuth + webhooks)
- **Testes**: Jest
- **Deploy**: Docker → GHCR

## Benefícios Esperados

- Redução significativa nos custos mensais
- Total controle sobre os fluxos e dados
- Possibilidade de evolução rápida conforme o negócio cresce
- Experiência unificada entre automação e atendimento humano

## Documentação

- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — arquitetura, fluxos
  críticos e regras de negócio verificados contra o código (gerado pela
  skill `explore-project`; regenerar após mudanças estruturais)
- [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) — convenções de
  desenvolvimento para agentes de IA trabalhando neste repo
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — diagrama e histórico real de entregas
- [`docs/API.md`](docs/API.md) — autenticação e contratos dos webhooks públicos
- [`docs/DATABASE.md`](docs/DATABASE.md) — modelo de dados
- [`docs/FLOWS.md`](docs/FLOWS.md) — comportamento real do flow builder
- [`docs/FULFILLMENT_API.md`](docs/FULFILLMENT_API.md) — contrato externo FenixCOD
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — decisões técnicas registradas

## Desenvolvimento

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # Jest
npx tsc --noEmit
npm run build
```

Variáveis de ambiente necessárias em `.env.local` — lista completa (sem
valores) em `CLAUDE.md`.

**Responsável:** Thiago Caffaro
