# Histórico de Entregas

> Este arquivo era o plano de roadmap do MVP (abril/2026). Quase tudo
> que estava listado como "futuro" já foi entregue — mantido aqui como
> registro histórico do que foi planejado vs. o que de fato aconteceu.
> Para o estado atual do produto, veja `PROJECT_CONTEXT.md` na raiz do
> repo; para o cronograma real por commit, veja a seção "O que já foi
> construído" em `docs/ARCHITECTURE.md`.

## Semana 1 (MVP original) — concluída em 2026-04

Objetivo original: sistema funcional de chat WhatsApp para atendimento
manual.

- [x] Evolution API rodando no TrueNAS
- [x] WhatsApp conectado via QR Code
- [x] Supabase configurado (tabelas `conversations` + `messages`)
- [x] Projeto Next.js criado com Tailwind + shadcn/ui
- [x] Webhook recebe mensagem → salva no Supabase
- [x] Interface lista conversas na sidebar
- [x] Interface exibe mensagens em bolhas
- [x] Atendente envia mensagem pela interface
- [x] Realtime: mensagens aparecem sem reload

Critério de conclusão original — atingido: receber mensagem no WhatsApp
aparece na interface; digitar resposta na interface chega no WhatsApp do
lead.

## O que foi planejado vs. o que realmente foi construído

O plano original (semanas/meses 2-6 abaixo) previa uma sequência linear
até "Fase 3+". Na prática, o desenvolvimento não seguiu essa ordem nem
esse ritmo — muita coisa listada como "fora do escopo Fase 3+" já está
em produção. Mantido como registro do plano original:

<details>
<summary>Plano original (histórico, não reflete a ordem real)</summary>

### Semana 2-3 (planejado)
- Botão "passar para humano" / "ativar IA"
- Tags nas conversas
- Status de mensagem (enviado/entregue/lido)
- UI polida estilo WhatsApp Web

### Mês 2 — Flow Builder (planejado)
- Canvas drag-and-drop com xyflow
- Blocos: Start, Message, End
- Salvar fluxo como JSON no Supabase
- Adicionar: Button, Condition

### Mês 3 — Flow Executor + Gatilho (planejado)
- Engine que lê JSON e executa blocos
- Mensagem inicial → identifica produto → dispara fluxo
- Testes com fluxo real no WhatsApp

### Mês 4 — Gemini (planejado)
- Bloco GeminiAssistant no flow builder
- Prompt base + prompt por produto
- Structured output com Zod
- Fallback Flash-Lite → Flash

### Mês 5 — Dashboard + Auth (planejado)
- Supabase Auth (login simples)
- Dashboard: conversas por período, por produto
- Custo estimado de IA

### Mês 6 — Polimento (planejado)
- Multi-número WhatsApp
- Testes com volume real
- Correções e estabilidade

### "Fora do escopo (Fase 3+)" — planejado como não-prioridade
- WhatsApp Cloud API oficial
- Pagamentos automáticos
- Multi-país / multi-moeda
- Export/Import de fluxos
- Analytics avançado por bloco

</details>

**O que de fato entrou em produção, fora dessa ordem**: flow builder e
motor de execução (sim), IA (sim, mas multi-provider — Gemini, OpenAI e
OpenRouter, não só Gemini), auth (sim, mas administrativa própria via
cookie HMAC — não Supabase Auth, ver `docs/DECISIONS.md` [009]),
WhatsApp Cloud API oficial (sim, dual com Evolution — apesar de estar
listado como "fora do escopo"), export/import de fluxos (sim). Além
disso, entrou uma integração inteira que não estava no plano original:
Shopify + fulfillment externo (FenixCOD) com fila de confirmação,
sandbox de testes, timeline de pedidos e recuperação de carrinho
abandonado.

Dashboard de analytics e multi-moeda/multi-país formal (além dos ~17
países já mapeados para fulfillment) seguem não implementados — ver
"Perguntas em aberto" em `PROJECT_CONTEXT.md`.
