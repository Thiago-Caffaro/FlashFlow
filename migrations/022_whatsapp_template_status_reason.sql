-- 022_whatsapp_template_status_reason.sql
-- Status de template atualizado em tempo real via webhook
-- (message_template_status_update): guarda o motivo informado pela Meta
-- (ex: rejeicao) e quando o status mudou pela ultima vez.

ALTER TABLE whatsapp_message_templates
  ADD COLUMN IF NOT EXISTS status_reason TEXT,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
