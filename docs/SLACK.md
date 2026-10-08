# Integração com o Slack

Avisos formais de **necessidade de atendimento humano** no Slack, com botão
**Assumir atendimento**. Baseado na Web API do Slack
(<https://docs.slack.dev/apis/>).

## Como funciona

| Peça | Onde |
|---|---|
| Conexão (bot token `xoxb-` + Signing Secret, cifrados em `app_settings`) | aba **Integrações** → `app/api/integrations/slack/route.ts`, `lib/slack-settings.ts` |
| Canal padrão, menção e encaminhamentos por conta WhatsApp | tabela `slack_notification_settings` (migration 024) → `app/api/integrations/slack/settings/route.ts` |
| Node **Slack — Atendimento humano** (`slackNotify`) | `lib/flow-engine.ts`, `components/flows/slack-notify-config.tsx` |
| Encaminhamento opcional de notificações existentes | `forwardNotificationToSlack` em `lib/slack-notifications.ts` |
| Botão "Assumir atendimento" | `POST /api/webhook/slack/interactivity` (público em `proxy.ts`, autenticado pela assinatura do Slack) |
| Registro das mensagens e de quem assumiu | tabela `slack_messages` (migration 024) |

### Node `slackNotify`

1. Renderiza título e mensagem com as mesmas variáveis dos outros nodes
   (`{{contato.*}}`, `{{pedido.*}}`, `{{carrinho.*}}`, personalizadas).
2. Cria sempre uma notificação interna (`type='escalation'`) — o registro
   existe mesmo se o Slack estiver fora do ar; nesse caso o motivo é anexado
   à mensagem da notificação.
3. Posta no canal do node (ou no canal padrão da conta) com Block Kit:
   contato, conta WhatsApp, origem, botão **Assumir atendimento** e link
   **Abrir FlashFlow**. Texto de cliente é escapado (`<`, `>`, `&`) — um nome
   como `<!channel>` nunca vira menção.
4. **Transferir para humano** (padrão ligado): marca `requires_human` na
   sessão de IA da conversa e encerra o fluxo ali, como um node "Fim".
   Desligado, o fluxo segue para o próximo node.

### Encaminhamentos (todos opt-in, por conta)

Desligados por padrão; só funcionam com canal padrão definido:

- **Escalonamento da IA** — quando o agente pede humano (`Chat escalado`).
  Só a criação da notificação dispara o envio (dedupe por `source_key`).
- **Node "Notificar"** — notificações internas dos fluxos.
- **Fora da janela de 24h** — mensagem não enviada pela Cloud API.

Falha no Slack nunca derruba o fluxo: o erro fica em `slack_messages.error`
e aparece na aba Notificações ("Falha ao avisar no Slack").

### "Assumir atendimento"

1. O Slack envia o clique para a Request URL (form-urlencoded, campo
   `payload`), assinado com o Signing Secret (`v0=HMAC-SHA256`), rejeitado
   se tiver mais de 5 min.
2. O clique é registrado atomicamente (`UPDATE ... WHERE claimed_at IS NULL`)
   — só o primeiro vence; os seguintes recebem uma mensagem efêmera dizendo
   quem assumiu.
3. Depois do `200` (o Slack exige resposta em até 3s): a notificação interna
   é marcada como lida, a sessão de IA da conversa passa a `requires_human`
   e a mensagem no Slack troca o botão por "Assumido por @fulano".

## Configuração (uma vez por workspace)

1. Em <https://api.slack.com/apps>: **Create New App → From a manifest**.
   O botão **Copiar manifesto do app** na aba Integrações já gera o JSON com
   a Request URL certa. Equivalente:

   ```json
   {
     "_metadata": { "major_version": 2, "minor_version": 1 },
     "display_information": { "name": "FlashFlow" },
     "features": { "bot_user": { "display_name": "FlashFlow", "always_online": true } },
     "oauth_config": { "scopes": { "bot": ["chat:write", "chat:write.public", "channels:read", "groups:read"] } },
     "settings": {
       "interactivity": { "is_enabled": true, "request_url": "https://SEU-DOMINIO/api/webhook/slack/interactivity" },
       "org_deploy_enabled": false,
       "socket_mode_enabled": false,
       "token_rotation_enabled": false
     }
   }
   ```

2. **Install App** → instalar no workspace → copiar o **Bot User OAuth
   Token** (`xoxb-…`).
3. **Basic Information → App Credentials** → copiar o **Signing Secret**.
4. Na aba **Integrações** do FlashFlow: colar os dois e **Conectar** (o token
   é validado com `auth.test` antes de ser salvo).
5. Por conta WhatsApp: escolher o canal padrão, a menção padrão e ligar os
   encaminhamentos desejados. **Enviar mensagem de teste** confere o canal.
6. Canais privados: convidar o bot no Slack com `/invite @FlashFlow` (o
   escopo `groups:read` só lista privados de que o bot participa;
   `chat:write.public` cobre os públicos sem convite).

| Escopo | Para quê |
|---|---|
| `chat:write` | postar e atualizar as mensagens |
| `chat:write.public` | postar em canal público sem convidar o bot |
| `channels:read` / `groups:read` | listar canais públicos / privados no seletor |

## Limitações conhecidas

- O link **Abrir FlashFlow** abre o app, não a conversa específica (o app
  ainda não tem deep link por conversa).
- "Assumir" pausa a IA (`requires_human`); gatilhos por palavra-chave ainda
  podem disparar numa próxima mensagem do cliente.
- Conexão única por instalação do FlashFlow (um workspace). Para vários
  workspaces seria preciso o fluxo OAuth "Adicionar ao Slack".
