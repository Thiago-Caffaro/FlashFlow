-- 018_conversations_last_inbound_at.sql
-- last_message_at nao serve pra janela de 24h da WhatsApp Cloud API: e
-- sobrescrito por envios nossos tambem, o que "reabriria" a janela
-- incorretamente. last_inbound_at so avanca em mensagens recebidas.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

UPDATE conversations c SET last_inbound_at = (
  SELECT MAX(m.created_at) FROM messages m
  WHERE m.conversation_id = c.id AND m.direction = 'inbound'
) WHERE last_inbound_at IS NULL;

CREATE INDEX IF NOT EXISTS conversations_last_inbound_at_idx ON conversations (last_inbound_at);
