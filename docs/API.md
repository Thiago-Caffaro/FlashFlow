# API Reference

**Base URL**: `/api`  
**Auth**: nenhuma no MVP semana 1  
**Content-Type**: `application/json`

---

## Webhook Evolution API

```
POST /api/webhook/evolution
```

Rota pública — recebe eventos da Evolution API.

**Payload recebido:**
```typescript
{
  event: "messages.upsert" | "connection.update" | ...
  instance: string
  data: {
    key: {
      remoteJid: string   // ex: "5511999999999@s.whatsapp.net"
      fromMe: boolean
      id: string          // ID da mensagem no WhatsApp
    }
    message: {
      conversation?: string   // texto simples
      extendedTextMessage?: { text: string }
    }
    pushName?: string         // nome do contato
  }
}
```

**Lógica interna:**
1. Ignora eventos que não sejam `messages.upsert`
2. Ignora mensagens `fromMe: true`
3. Extrai número: remove `@s.whatsapp.net`
4. Upsert em `conversations` (cria ou atualiza)
5. Insert em `messages` com `direction: inbound`

---

## Enviar Mensagem

```
POST /api/messages/send
```

```typescript
// body
{
  conversationId: string
  content: string
}

// response
{
  success: boolean
  messageId: string
}
```

**Lógica interna:**
1. Busca `contact_phone` da conversa no Supabase
2. Chama Evolution API: `POST /message/sendText/flashflow-main`
3. Salva mensagem no Supabase com `direction: outbound`

---

## Listar Conversas

```
GET /api/conversations
```

```typescript
// response
{
  conversations: {
    id: string
    wa_id: string
    contact_name: string | null
    contact_phone: string
    last_message: string | null
    last_message_at: string | null
    unread_count: number
    created_at: string
  }[]
}
```

---

## Buscar Mensagens

```
GET /api/conversations/[id]/messages
```

```typescript
// response
{
  messages: {
    id: string
    content: string
    direction: "inbound" | "outbound"
    status: string
    created_at: string
  }[]
}
```

---

## Evolution API (referência interna)

Base URL: `http://100.119.152.43:8080`  
Header obrigatório: `apikey: flashflow123456`  
Instância: `flashflow-main`

```
GET  /instance/fetchInstances              → status das instâncias
GET  /instance/connect/flashflow-main      → QR code
POST /message/sendText/flashflow-main      → enviar mensagem
POST /webhook/set/flashflow-main           → configurar webhook
```

**Payload envio de mensagem:**
```typescript
{
  number: "5511999999999",    // sem @s.whatsapp.net
  text: "Olá!"
}
```
