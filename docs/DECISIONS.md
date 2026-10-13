# Decisões Técnicas

Registro das decisões para não reabrir discussões resolvidas.

---

## [001] Next.js full-stack (sem backend separado)
**Decisão**: tudo em Next.js 15 App Router — frontend + API Routes  
**Motivo**: solo dev, menos infraestrutura, deploy simples  
**Descartado**: NestJS separado — overhead desnecessário no MVP  

---

## [002] Supabase (não PostgreSQL self-hosted)
**Decisão**: Supabase como banco gerenciado  
**Motivo**: PostgreSQL gerenciado grátis, Realtime nativo, zero infra  
**Descartado**: PostgreSQL + Redis local  
**ORM**: nenhum — supabase-js direto

---

## [003] Sem autenticação no MVP semana 1 — SUPERADA por [009]
**Decisão original**: sem auth na primeira semana  
**Motivo**: não bloqueia validação do core  
**Revisão prevista**: Supabase Auth após MVP funcionar  
**O que realmente aconteceu**: implementada em 2026-06-26 (`3361b5e`), mas
**não** com Supabase Auth — ver [009].

---

## [004] Evolution API self-hosted no TrueNAS
**Decisão**: Evolution API v2.2.3 no TrueNAS Scale via Docker  
**Acesso**: Tailscale — IP fixo privado (ver `.env.local`)  
**Risco**: banimento do número WhatsApp  
**Mitigação**: rate limit, delays humanizados — mesmo assim, um número já
foi banido por mass-send em 2026-07-28 por um bug de disparo em rajada na
integração Shopify (corrigido no mesmo dia; ver histórico de memória do
projeto)  
**Fase 2 (concluída)**: WhatsApp Cloud API oficial adicionada como segundo
provedor **em paralelo** ao Evolution — não substituiu, ver [010]

---

## [005] Supabase Realtime (não Socket.io)
**Decisão**: Supabase Realtime para tempo real  
**Motivo**: incluso no Supabase, zero config extra  
**Descartado**: Socket.io — requer servidor dedicado

---

## [006] Upstash Redis
**Decisão**: Upstash Redis grátis  
**Motivo**: Evolution API v2.2.3 requer Redis  
**Uso**: exclusivo para Evolution API internamente

---

## [007] IA no flow builder — SUPERADA por [011]
**Status original**: não implementado, planejado só Gemini 2.5 Flash-Lite
(primário) + Flash (fallback)  
**O que realmente aconteceu**: implementado com suporte a três provedores
(Gemini, OpenAI, OpenRouter), configurável por node — ver [011].

---

## [008] Flow Builder — Fase 2 — CONCLUÍDA
**Decisão**: xyflow, fluxo salvo como JSONB no Supabase (coluna `json` em
`flows`)  
**Status**: implementado — motor de execução próprio em
`lib/flow-engine.ts`, com fila assíncrona (`flow_jobs`) para casos que
não podem rodar síncrono no webhook (pedido Shopify ainda não
sincronizado, disparo por evento externo). Detalhes em `docs/FLOWS.md` e
`PROJECT_CONTEXT.md`.

---

## [009] Auth administrativa própria, não Supabase Auth
**Decisão**: sessão única de administrador via cookie HMAC assinado
(`ff_auth`), sem tabela de sessões — revogar todas as sessões ativas é
rotacionar `AUTH_SECRET` (invalida a assinatura de qualquer token
emitido antes)  
**Motivo**: o produto não é multi-usuário por cliente final — é um único
operador (ou pequena equipe) administrando várias contas/instâncias de
WhatsApp. Supabase Auth (multi-usuário, RLS por `auth.uid()`) resolveria
um problema que o produto não tem.  
**Isolamento real**: por `instance_name` (conta WhatsApp), não por
usuário — reforçado por `lib/instance-guard.ts` e testes dedicados de
isolamento em `__tests__/api/*-isolation.test.ts`  
**Implementado em**: 2026-06-26 (`3361b5e`)  
**Descartado**: Supabase Auth — como não há necessidade de múltiplos
usuários/papéis, adicionaria complexidade sem resolver um problema real

---

## [010] WhatsApp Cloud API como segundo provedor, não substituição
**Decisão**: suportar Evolution API e WhatsApp Cloud API **em paralelo**,
escolhido por conta (`accounts.provider`), não migrar todas as contas de
uma vez  
**Motivo**: a Cloud API oficial é mais estável e sem risco de ban, mas
tem restrições que a Evolution não tem (janela de resposta de 24h,
templates aprovados pela Meta) — permitir escolher por conta deixa o
operador migrar gradualmente sem perder as contas já configuradas na
Evolution  
**Implementado em**: 2026-08-12 a 2026-08-27, em 4 fases incrementais
(conexão → mídia → botões interativos → templates e janela de 24h)  
**Consequência de design**: a janela de 24h só é aplicada quando
`provider==='cloud_api'` (`lib/flow-engine.ts:1509`) — contas Evolution
nunca são bloqueadas por ela, porque a restrição vem da Meta, não do
produto

---

## [011] IA multi-provider, não só Gemini
**Decisão**: node `aiAssistant` do flow builder suporta Gemini, OpenAI e
OpenRouter, escolhido por node, com fallback de modelo padrão por
provedor  
**Motivo**: não documentado explicitamente no histórico de commits —
provavelmente flexibilidade de custo/qualidade por caso de uso  
**Segurança**: credenciais de cada provedor cifradas em repouso
(AES-256-GCM, `lib/ai-crypto.ts`), nunca em texto plano

---

## [012] Sandbox como aba própria do app principal, com fluxos e gatilhos embutidos
**Status**: Aceita e implementada (2026-10-13, v1.15.0)  
**Decisores**: Thiago (operador/dev)

### Contexto
O Sandbox vive em `/fulfillment` → aba **Sandbox**
(`components/fulfillment/sandbox-panel.tsx`), mas o que se ajusta durante
um teste — fluxos e gatilhos da conta `__sandbox__` — vive no app
principal (`app/page.tsx`). O atalho **Configurar gatilho** grava
`activeInstance=__sandbox__` no `localStorage` e navega para `/`. O ciclo
de cada ajuste fica assim: Pedidos → Sandbox → Configurar gatilho →
editar → voltar → Pedidos → Sandbox. São duas páginas, dois carregamentos
completos e o estado do teste perdido a cada volta (contato ativo,
formulário de pedido, rolagem do chat).

Efeito colateral: depois do atalho, o app principal fica preso na conta
sandbox. O `account-dropdown` esconde contas `isSandbox`, então o operador
nem vê que está nela (`contexts/account-context.tsx:45`).

O que torna a mudança barata:
- `TriggersTab` e `FlowsTab` dependem só da prop `instanceName`, sem
  `useAccount`. Podem ser montadas com `SANDBOX_INSTANCE_NAME`.
- `FlowCanvas` é `absolute inset-0` e preenche qualquer container
  `relative`.
- `app/api/fulfillment/sandbox/message` lê `triggers` do banco a cada
  mensagem. Um gatilho ou fluxo salvo vale já na próxima mensagem de
  teste, sem recarregar nada.

### Decisão
Criar a view `sandbox` no `VerticalTabBar`, logo abaixo de **Memória**.
Dentro dela, um layout dividido:

- **Esquerda, fixa (~400px):** conversa de teste e seletor de contato.
  Sempre visível, com barra para recolher.
- **Direita, sub-abas:** **Gatilhos** | **Fluxos** | **Simular pedido** |
  **Produtos fictícios**. Gatilhos e Fluxos são as mesmas `TriggersTab` e
  `FlowsTab`, presas a `__sandbox__`.

Edita-se o fluxo à direita e testa-se à esquerda, sem trocar de página.
A aba Sandbox sai de `/fulfillment`.

Adição pedida na aprovação: a sub-aba **Visão geral** (padrão) mostra três
**mini janelas** (gatilhos, fluxos e memória da conta sandbox) como atalho
visual. Clicar num item abre a sub-aba já com ele aberto (prop `focus` em
`TriggersTab`/`FlowsTab`/`MemoryTab`). Os fluxos podem ser ligados e
desligados ali mesmo, e há aviso quando falta gatilho de mensagem ou um
gatilho aponta para fluxo inativo.

### Opções consideradas

#### A — View própria no app principal, layout dividido (escolhida)
| Dimensão | Avaliação |
|---|---|
| Complexidade | Média. Reaproveita Triggers e Flows; quebra o `sandbox-panel` (822 linhas) em componentes |
| Custo | Nenhum de infra. Exige cuidado com polling (ver Consequências) |
| Escalabilidade | Novas ferramentas viram sub-abas (ex.: Memória do sandbox) |
| Familiaridade | Alta. Mesmo padrão de painéis de `app/page.tsx` |

**Prós:** ciclo editar→testar sem navegação; um só lugar; some o hack do
`localStorage`; não mexe no motor de fluxo nem nas rotas.  
**Contras:** o canvas de fluxo fica mais estreito com o chat aberto
(mitigado ao recolher o chat); `app/page.tsx` ganha um 10º painel.

#### B — Manter em `/fulfillment`, embutindo Gatilhos e Fluxos lá
| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa |
| Custo | Nenhum |
| Escalabilidade | Ruim. `/fulfillment` acumula ferramenta que não é de pedidos |
| Familiaridade | Alta |

**Prós:** mudança menor.  
**Contras:** não atende ao pedido de mover para abaixo de Memória; o
sandbox continua escondido em Pedidos, sendo que testa fluxos e IA, não
só pedidos.

#### C — "Modo sandbox" como conta selecionável no seletor de contas
| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa no código, alta no risco de uso |
| Custo | Nenhum |
| Escalabilidade | Média |
| Familiaridade | Alta |

**Prós:** todas as abas (Chats, Memória, IA) passam a valer para o
sandbox sem código novo.  
**Contras:** é generalizar o hack atual. O operador pode esquecer que
está no sandbox e editar a conta errada. Chats/Notificações da conta
fictícia não fazem sentido. A simulação de pedido continua em outro
lugar. Descartada.

### Análise de trade-offs
O ganho está em **ver o efeito de uma edição sem sair da tela**. A e B
resolvem isso; só A põe o sandbox onde ele é usado (fluxos e IA) e
atende à posição pedida. C troca uma navegação ruim por um estado global
ambíguo, que é o problema que já existe hoje. O custo extra de A é
organizacional (quebrar um arquivo grande), não técnico.

### Consequências
- **Mais fácil:** iterar em fluxos; testar gatilho + fluxo + pedido
  simulado na mesma tela; acrescentar ferramentas de teste.
- **Mais difícil / atenção:**
  - **Polling.** `app/page.tsx` monta todos os painéis ao mesmo tempo, e o
    chat do sandbox consulta a cada 3s. Se não for limitado à view ativa e
    à aba visível do navegador, reabre o egress cortado na v1.13.1. O
    componente recebe `active` e só consulta quando
    `active && visibilityState==='visible'`. Os dados de produtos e
    contas também carregam sob demanda, na primeira ativação.
  - `TAB_INDEX` muda (galeria 6, ia 7, integrações 8, conf-gerais 9).
    `activeView` salvo no `localStorage` continua válido porque é por id,
    não por índice.
  - Quem já ficou preso em `activeInstance=__sandbox__` precisa de
    limpeza: o `account-context` passa a ignorar conta `isSandbox` ao
    restaurar do `localStorage`.
- **Revisitar depois:**
  - "Copiar fluxo de uma conta real para o sandbox" (o export/import JSON
    de `flow-transfer` já existe).

### Itens de ação
1. [x] Quebrar `sandbox-panel.tsx` em `components/sandbox/`:
   `sandbox-tab` (layout), `sandbox-chat`, `sandbox-contacts`,
   `sandbox-order-simulator`, `sandbox-fictitious-products`, cada um com
   seu próprio fetch.
2. [x] `View` + `TABS` + `TAB_INDEX`: inserir `sandbox` (ícone
   `FlaskConical`) após `memoria`; montar o painel em `app/page.tsx`
   passando `active`.
3. [x] Sub-abas Gatilhos/Fluxos com `TriggersTab`/`FlowsTab`
   (`instanceName={SANDBOX_INSTANCE_NAME}`) e botão para recolher o chat
   ao editar no canvas.
4. [x] Polling do chat condicionado a `active` + aba visível do navegador.
5. [x] Remover a aba `sandbox` de `fulfillment-page.tsx` e o botão
   **Configurar gatilho**. No lugar, um link "Sandbox foi para o menu
   principal".
6. [x] `account-context`: não restaurar conta `isSandbox` do
   `localStorage`.
7. [x] Testes: o painel não consulta quando inativo; as sub-abas montam
   com `__sandbox__`. Bump de `APP_VERSION` e atualizar `docs/FLOWS.md`
   (seção Sandbox).
