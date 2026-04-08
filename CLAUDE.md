## CLAUDE.md:

```markdown
# FlashFlow — Contexto para Claude Code

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
│   ├── api/
│   │   ├── webhook/evolution/route.ts  # recebe mensagens
│   │   └── messages/route.ts           # envia mensagens
│   └── page.tsx                        # interface de chat
├── lib/
│   └── supabase.ts                     # cliente Supabase
├── components/                         # componentes UI
├── .env.local
└── CLAUDE.md
```

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
