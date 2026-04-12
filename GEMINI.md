## CLAUDE.md:

```markdown
# FlashFlow — Contexto para Gemini CLI

## O que é este projeto
SaaS de atendimento WhatsApp com construtor visual de fluxos e IA (Gemini).

## Stack real (não altere)
- **Frontend + Backend**: Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui
- **Banco**: Supabase (PostgreSQL + Realtime)
- **Auth**: Nenhuma no MVP
- **WhatsApp**: Evolution API v2.2.3 (self-hosted no TrueNAS via Tailscale)
- **IA**: Google Gemini (Fase 5 — não implementar agora)
- **Flow Builder**: xyflow (Fase 3 — não implementar agora)

## Infraestrutura
- Evolution API: http://100.119.152.43:8080
- Instance: flashflow-main
- Evolution API Key: flashflow123456 (usar via env)

## Estrutura de pastas
```
flashflow/
├── app/
├── api/                    # API Routes (backend)
│   ├── webhook/evolution/route.ts
│   ├── messages/route.ts
│   └── conversations/route.ts
├── (chat)/                 # Grupo de rotas da interface
│   └── page.tsx
├── layout.tsx
└── globals.css
components/
├── ui/                     # Componentes shadcn (não editar)
├── chat/                   # Componentes do chat
│   ├── conversation-list.tsx
│   ├── conversation-item.tsx
│   ├── chat-window.tsx
│   ├── message-bubble.tsx
│   └── message-input.tsx
└── shared/                 # Componentes reutilizáveis
lib/
├── supabase.ts             # cliente Supabase (client-side)
├── supabase-server.ts      # cliente Supabase (server-side, service role)
└── evolution.ts            # wrapper Evolution API
types/
└── index.ts                # todos os tipos TypeScript do projeto
hooks/
└── use-conversations.ts    # hooks customizados
├── .env.local
└── CLAUDE.md
```
### Regras de componentes
- 1 componente por arquivo
- Nome do arquivo = nome do componente em kebab-case
- Componentes client-side: adicionar 'use client' no topo
- Componentes server-side: sem diretiva (padrão no App Router)
- Props sempre tipadas com interface explícita

### Regras de API Routes
- Toda lógica de banco fica na route, não no componente
- Sempre usar supabaseAdmin (service role) nas API routes
- Nunca expor SUPABASE_SERVICE_ROLE_KEY no client-side
- Retornar sempre { ok: true/false } + dados ou erro

### Nomenclatura
- Arquivos: kebab-case (conversation-list.tsx)
- Componentes: PascalCase (ConversationList)
- Funções: camelCase (fetchConversations)
- Tipos/Interfaces: PascalCase (Conversation, Message)
- Constantes: UPPER_SNAKE_CASE (EVOLUTION_API_URL)

### Estilo
- Tailwind para tudo — sem CSS modules, sem styled-components
- shadcn/ui para componentes base
- Tema escuro como padrão (fundo #111b21 estilo WhatsApp)
- Mobile-first

## Variáveis de ambiente
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
EVOLUTION_API_URL=http://100.119.152.43:8080
EVOLUTION_API_KEY=flashflow123456
```

## Schema do banco (Supabase)
```sql
conversations: id, wa_id, contact_name, contact_phone, 
               last_message, last_message_at, unread_count,
               created_at, updated_at

messages: id, conversation_id, wa_message_id, content,
          type, direction (inbound/outbound), status, created_at
```

## Fase atual: MVP semana 1
Escopo exato:
1. Webhook recebe mensagem → salva no Supabase
2. Interface lista conversas (sidebar)
3. Interface mostra mensagens (chat)
4. Enviar mensagem pela interface → Evolution API → WhatsApp

## Princípios
1. TypeScript — sem `any`
2. Tratar erros explicitamente
3. Não implementar nada fora do escopo MVP semana 1
4. Tudo em Next.js App Router — sem backend separado
```
