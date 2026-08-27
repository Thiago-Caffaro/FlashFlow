-- 017_whatsapp_cloud_credentials.sql
-- Credenciais por conta da WhatsApp Cloud API (Meta) — mesmo padrao de trio
-- criptografado ja usado em shopify_integrations (ver lib/ai-crypto.ts).
-- phone_number_id e a chave que o webhook usa para resolver instance_name a
-- partir de um evento inbound, por isso e UNIQUE e indexado.

CREATE TABLE IF NOT EXISTS whatsapp_cloud_credentials (
  instance_name          TEXT PRIMARY KEY REFERENCES accounts(instance_name) ON DELETE CASCADE,
  waba_id                TEXT NOT NULL,
  phone_number_id        TEXT NOT NULL UNIQUE,
  business_id            TEXT,
  display_phone_number   TEXT,
  verified_name          TEXT,
  encrypted_access_token TEXT NOT NULL,
  access_token_iv        TEXT NOT NULL,
  access_token_auth_tag  TEXT NOT NULL,
  token_expires_at       TIMESTAMPTZ,
  last_verified_at       TIMESTAMPTZ,
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_cloud_credentials_phone_number_id_idx
  ON whatsapp_cloud_credentials (phone_number_id);

ALTER TABLE whatsapp_cloud_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE whatsapp_cloud_credentials FROM anon, authenticated;
GRANT ALL ON TABLE whatsapp_cloud_credentials TO service_role;
