# MVP — Escopo

## Semana 1 (escopo atual)
Objetivo: sistema funcional de chat WhatsApp para atendimento manual.

### Checklist

- [x] Evolution API rodando no TrueNAS
- [x] WhatsApp conectado via QR Code (instância: flashflow-main)
- [x] Supabase configurado (tabelas conversations + messages)
- [x] Projeto Next.js criado com Tailwind + shadcn/ui
- [ ] Webhook recebe mensagem → salva no Supabase
- [ ] Interface lista conversas na sidebar
- [ ] Interface exibe mensagens em bolhas
- [ ] Atendente envia mensagem pela interface
- [ ] Realtime: mensagens aparecem sem reload

### Critério de conclusão
Receber mensagem no WhatsApp → aparece na interface.
Digitar resposta na interface → chega no WhatsApp do lead.

---

## Semana 2-3 (próximo)
- Botão "passar para humano" / "ativar IA"
- Tags nas conversas
- Status de mensagem (enviado/entregue/lido)
- UI polida estilo WhatsApp Web

---

## Mês 2 — Flow Builder
- Canvas drag-and-drop com xyflow
- Blocos: Start, Message, End
- Salvar fluxo como JSON no Supabase
- Adicionar: Button, Condition

---

## Mês 3 — Flow Executor + Gatilho
- Engine que lê JSON e executa blocos
- Mensagem inicial → identifica produto → dispara fluxo
- Testes com fluxo real no WhatsApp

---

## Mês 4 — Gemini
- Bloco GeminiAssistant no flow builder
- Prompt base + prompt por produto
- Structured output com Zod
- Fallback Flash-Lite → Flash

---

## Mês 5 — Dashboard + Auth
- Supabase Auth (login simples)
- Dashboard: conversas por período, por produto
- Custo estimado de IA

---

## Mês 6 — Polimento
- Multi-número WhatsApp
- Testes com volume real
- Correções e estabilidade

---

## Fora do escopo (Fase 3+)
- WhatsApp Cloud API oficial
- Pagamentos automáticos
- Multi-país / multi-moeda
- Export/Import de fluxos
- Analytics avançado por bloco
