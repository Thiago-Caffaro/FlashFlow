# Arquitetura do Sistema

## Diagrama atual (MVP semana 1)

```
┌─────────────────────────────────────────────────────────┐
│                    LEAD FINAL                            │
│               (WhatsApp no celular)                      │
└──────────────────────┬──────────────────────────────────┘
                       │ mensagem
                       ▼
┌─────────────────────────────────────────────────────────┐
│           Evolution API v2.2.3 (TrueNAS)                │
│     Docker — http://100.119.152.43:8080                  │
│     Instância: flashflow-main                            │
│     Redis: Upstash (cache interno)                       │
└──────────────────────┬──────────────────────────────────┘
                       │ webhook POST
                       ▼
┌─────────────────────────────────────────────────────────┐
│             Next.js 15 (App Router)                      │
│                                                          │
│  POST /api/webhook/evolution  ← recebe mensagens         │
│  POST /api/messages/send      ← envia mensagens          │
│  GET  /api/conversations      ← lista conversas          │
└──────────────┬───────────────────────────────────────────┘
               │ Supabase client
               ▼
┌─────────────────────────────────────────────────────────┐
│                    Supabase                              │
│         PostgreSQL + Realtime                            │
│  Tabelas: conversations, messages                        │
└─────────────────────────────────────────────────────────┘
               │ Supabase Realtime
               ▼
┌─────────────────────────────────────────────────────────┐
│             Interface de Chat (Next.js)                  │
│   Sidebar conversas | Bolhas | Input envio               │
└─────────────────────────────────────────────────────────┘
```

---

## Fluxo de uma mensagem recebida

```
1. Lead envia mensagem no WhatsApp
2. Evolution API recebe e faz POST em /api/webhook/evolution
3. Webhook valida o payload
4. Busca conversa existente pelo número (wa_id) no Supabase
   └─ NÃO existe → cria nova conversa
   └─ SIM existe → atualiza last_message e last_message_at
5. Salva mensagem na tabela messages (direction: inbound)
6. Supabase Realtime notifica o frontend automaticamente
7. Interface atualiza sem reload
```

---

## Fluxo de envio de mensagem

```
1. Atendente digita mensagem e clica enviar
2. Frontend chama POST /api/messages/send
3. API chama Evolution API → envia pro WhatsApp real
4. Salva mensagem no Supabase (direction: outbound)
5. Supabase Realtime atualiza a interface
```

---

## Roadmap de arquitetura

```
Fase 2: Flow Builder (xyflow) + Flow Executor (state machine)
Fase 3: Bloco Gemini (IA conversacional)
Fase 4: Dashboard analytics
Fase 5: Auth (Supabase Auth)
Fase 6: Multi-número WhatsApp
```

---

## Infraestrutura atual

| Serviço | Onde roda | Endereço |
|---|---|---|
| Next.js | localhost:3000 / Vercel | — |
| Evolution API | TrueNAS Scale (Docker) | http://100.119.152.43:8080 |
| Supabase | Cloud grátis | lyaaxlbzahvklibomske.supabase.co |
| Upstash Redis | Cloud grátis | prompt-finch-83300.upstash.io |
