# MVP — Escopo e Critérios de Conclusão

**Prazo alvo**: 4–6 semanas  
**Objetivo**: sistema funcional para 1 cliente real, 1 número WhatsApp, 4 produtos.

---

## O que ESTÁ no MVP

### 1. Autenticação & Multi-tenant
- [ ] Login/signup via Clerk
- [ ] Organização criada automaticamente no primeiro login
- [ ] Dados isolados por `organization_id`

### 2. Conexão WhatsApp
- [ ] Conectar 1 número via QR Code (Evolution API)
- [ ] Reconectar automaticamente após queda
- [ ] Status de conexão em tempo real (Socket.io)

### 3. Gatilho Inicial
- [ ] Identificar mensagem inicial por palavra-chave exata
- [ ] Mapear palavra-chave → produto → fluxo ativo
- [ ] Ignorar mensagens que não batem com nenhum gatilho

### 4. Flow Builder
- [ ] Canvas drag-and-drop (xyflow)
- [ ] Blocos: Start, Message, Button, Condition, GeminiAssistant, End
- [ ] Salvar fluxo como JSON no PostgreSQL
- [ ] Publicar/despublicar fluxo
- [ ] 1 fluxo ativo por produto

### 5. Flow Executor (engine)
- [ ] State machine que processa JSON do fluxo
- [ ] Executar blocos em sequência
- [ ] Lógica de condição (OU entre condições)
- [ ] Timeout por inatividade configurável
- [ ] Persistir estado da conversa no Redis

### 6. Bloco Gemini
- [ ] Prompt base + prompt do produto combinados
- [ ] Structured output obrigatório
- [ ] Fallback Flash-Lite → Flash em erro
- [ ] Temperatura configurável no bloco

### 7. Interface de Atendimento
- [ ] Lista de conversas (sidebar esquerda)
- [ ] Chat com bolhas (estilo WhatsApp Web)
- [ ] Envio de mensagem manual pelo atendente
- [ ] Botão "Passar para humano" / "Ativar IA"
- [ ] Status "digitando" em tempo real

### 8. Dashboard Básico
- [ ] Conversas iniciadas (últimos 7/30 dias)
- [ ] Taxa de resposta à mensagem inicial
- [ ] Conversas por produto
- [ ] Custo estimado de IA (tokens × preço)

---

## O que NÃO está no MVP (Fase 2+)

- ❌ Múltiplos números WhatsApp
- ❌ Multi-país / multi-moeda automático
- ❌ Function calling avançado (marcar_venda etc.)
- ❌ Export/Import de fluxos
- ❌ WhatsApp Cloud API oficial
- ❌ Pagamentos automáticos
- ❌ Versioning de fluxos
- ❌ Analytics avançado por bloco

---

## Critérios de "MVP pronto"
1. Cliente envia mensagem pelo WhatsApp → fluxo dispara corretamente
2. Bloco Gemini responde dentro de 800ms (p95)
3. Atendente consegue assumir conversa manualmente
4. Dashboard mostra pelo menos 3 métricas reais
5. Sistema sobrevive 24h sem queda em carga leve

---

## Riscos principais
| Risco | Probabilidade | Mitigação |
|-------|--------------|-----------|
| Banimento do número WhatsApp | Média | Rate limit, proxy, fingerprint realista |
| Latência Gemini > 800ms | Baixa | Flash-Lite primeiro, Flash como fallback |
| Evolution API instável | Média | Retry + reconexão automática |
| Estado perdido no Redis | Baixa | TTL longo + backup no Postgres |
