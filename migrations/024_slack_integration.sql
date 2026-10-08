-- 024_slack_integration.sql
-- Integração com Slack. A conexão (bot token xoxb e signing secret) é
-- global e fica cifrada em app_settings — aqui só ficam as regras por conta
-- WhatsApp e o registro das mensagens postadas (para o botão "Assumir").

-- Encaminhamento automático de notificações por conta WhatsApp. Tudo
-- desligado por padrão: o operador ativa cada tipo manualmente.
CREATE TABLE IF NOT EXISTS public.slack_notification_settings (
  instance_name text PRIMARY KEY,
  channel_id text,
  channel_name text,
  mention text NOT NULL DEFAULT 'none' CHECK (mention IN ('none', 'here', 'channel')),
  forward_ai_escalation boolean NOT NULL DEFAULT false,
  forward_flow_notify boolean NOT NULL DEFAULT false,
  forward_outside_window boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Cada mensagem postada no Slack. O botão "Assumir atendimento" carrega o
-- id desta linha; o clique é registrado atomicamente (claimed_at IS NULL).
CREATE TABLE IF NOT EXISTS public.slack_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name text NOT NULL,
  source text NOT NULL CHECK (source IN ('flow_node', 'ai_escalation', 'flow_notify', 'outside_window', 'test')),
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  channel_id text NOT NULL,
  message_ts text,
  claimed_by_slack_user_id text,
  claimed_by_name text,
  claimed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS slack_messages_channel_ts_idx
  ON public.slack_messages (channel_id, message_ts)
  WHERE message_ts IS NOT NULL;

CREATE INDEX IF NOT EXISTS slack_messages_notification_idx
  ON public.slack_messages (notification_id)
  WHERE notification_id IS NOT NULL;

ALTER TABLE public.slack_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.slack_notification_settings FROM anon, authenticated;
REVOKE ALL ON TABLE public.slack_messages FROM anon, authenticated;
GRANT ALL ON TABLE public.slack_notification_settings TO service_role;
GRANT ALL ON TABLE public.slack_messages TO service_role;
