-- 019_whatsapp_message_templates.sql
-- Templates sincronizados do WhatsApp Manager da Meta (so leitura — criacao
-- continua la, nao dentro do FlashFlow). language sem default: vem sempre
-- preenchido pela sincronizacao, que sempre retorna o idioma real do
-- template; nao faz sentido chutar um idioma default aqui.

CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name      TEXT NOT NULL REFERENCES accounts(instance_name) ON DELETE CASCADE,
  meta_template_id   TEXT,
  meta_template_name TEXT NOT NULL,
  language           TEXT NOT NULL,
  category           TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'paused', 'disabled')),
  body_text          TEXT NOT NULL,
  variable_count     INT NOT NULL DEFAULT 0,
  header_type        TEXT,
  footer_text        TEXT,
  buttons            JSONB NOT NULL DEFAULT '[]',
  last_synced_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instance_name, meta_template_name, language)
);

ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE whatsapp_message_templates FROM anon, authenticated;
GRANT ALL ON TABLE whatsapp_message_templates TO service_role;
