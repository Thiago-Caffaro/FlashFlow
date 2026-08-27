-- 020_shopify_recovery_template.sql
-- Recuperação de carrinho abandonado é sempre uma mensagem iniciada pela
-- empresa (o cliente nunca escreveu sobre esse carrinho) — numa conta
-- cloud_api fora da janela de 24h, texto livre é rejeitado pela Meta. Esses
-- dois campos permitem configurar um template aprovado como alternativa.

ALTER TABLE shopify_integrations
  ADD COLUMN IF NOT EXISTS recovery_template_id UUID REFERENCES whatsapp_message_templates(id) ON DELETE SET NULL;

ALTER TABLE shopify_integrations
  ADD COLUMN IF NOT EXISTS recovery_template_variable_map JSONB NOT NULL DEFAULT '{}';
