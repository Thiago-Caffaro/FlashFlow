# Database

**Engine**: PostgreSQL via Supabase  
**Cliente**: `@supabase/supabase-js` (sem ORM)  
**ID padrão**: UUID com `gen_random_uuid()`

---

## Schema atual (MVP semana 1)

```sql
CREATE TABLE conversations (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wa_id            TEXT NOT NULL UNIQUE,
  contact_name     TEXT,
  contact_phone    TEXT NOT NULL,
  last_message     TEXT,
  last_message_at  TIMESTAMPTZ,
  unread_count     INT DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE messages (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id  UUID REFERENCES conversations(id) ON DELETE CASCADE,
  wa_message_id    TEXT UNIQUE,
  content          TEXT NOT NULL,
  type             TEXT DEFAULT 'text',
  direction        TEXT NOT NULL,   -- 'inbound' | 'outbound'
  status           TEXT DEFAULT 'sent',
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
```

---

## Schema futuro (Fase 2+)

Campos a adicionar em `conversations`:
- `product_id` — produto/fluxo associado
- `is_human` — atendente assumiu
- `is_ai_enabled` — IA ativa
- `status` — ACTIVE, WAITING_HUMAN, RESOLVED
- `tags` — array de strings

Tabelas novas:
- `products` — keyword de gatilho + prompt Gemini
- `flows` — JSON do xyflow (nodes + edges)
- `flow_executions` — histórico por conversa
- `analytics_events` — eventos para dashboard

---

## Clientes Supabase

```typescript
// lib/supabase.ts — frontend
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// lib/supabase-server.ts — API Routes (acesso total)
import { createClient } from '@supabase/supabase-js'
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

---

## Realtime

```typescript
supabase
  .channel('messages')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: `conversation_id=eq.${conversationId}`
  }, (payload) => {
    // nova mensagem chegou — atualiza UI
  })
  .subscribe()
```
