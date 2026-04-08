# FlashFlow — Contexto para Claude Code

## O que é este projeto
SaaS de automação de atendimento WhatsApp com construtor visual de fluxos (drag-and-drop) e IA integrada (Gemini). Substitui o BotConversa com controle total e custo menor.

## Stack (não altere sem consultar)
- **Frontend**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS + shadcn/ui
- **Flow Builder**: xyflow (React Flow v12+)
- **Backend**: NestJS + TypeScript
- **Banco**: PostgreSQL 16 + JSONB + Redis
- **ORM**: Prisma
- **Auth**: Clerk (multi-tenant)
- **Real-time**: Socket.io + Redis
- **IA**: Google Gemini 2.5 Flash / Flash-Lite
- **WhatsApp**: Evolution API (self-hosted)
- **Deploy**: Docker + Railway / Hetzner

## Estrutura de pastas esperada
```
flashflow/
├── apps/
│   ├── web/          # Next.js 15 frontend
│   └── api/          # NestJS backend
├── packages/
│   ├── db/           # Prisma schema + migrations
│   ├── types/        # TypeScript types compartilhados
│   └── utils/        # Helpers compartilhados
├── docker-compose.yml
├── CLAUDE.md
└── docs/
    ├── ARCHITECTURE.md
    ├── DATABASE.md
    ├── API.md
    └── FLOWS.md
```

## Princípios de código (sempre siga)
1. TypeScript strict — sem `any`
2. Zod para validação em todas as entradas
3. Tratar erros explicitamente (sem silenciar exceções)
4. Comentários apenas em lógica não óbvia
5. Nomes em inglês no código, português nos comentários/docs
6. Nunca commitar segredos — usar `.env.example`

## Fase atual: MVP
Foco exclusivo no MVP. Ver `docs/MVP.md` para escopo exato.
Não implemente nada da Fase 2 ou 3 sem sinalizar claramente.

## Comandos úteis
```bash
# Dev
pnpm dev              # roda frontend + backend
pnpm dev:web          # só frontend
pnpm dev:api          # só backend

# DB
pnpm db:migrate       # roda migrations
pnpm db:studio        # Prisma Studio
pnpm db:seed          # seed de dev

# Testes
pnpm test             # unit tests
pnpm test:e2e         # e2e tests

# Build
pnpm build
pnpm docker:up        # sobe todos os containers
```
