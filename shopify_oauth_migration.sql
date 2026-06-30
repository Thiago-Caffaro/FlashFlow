-- Shopify OAuth support + app-wide encrypted settings

ALTER TABLE shopify_integrations
  ALTER COLUMN encrypted_webhook_secret DROP NOT NULL,
  ALTER COLUMN webhook_secret_iv DROP NOT NULL,
  ALTER COLUMN webhook_secret_auth_tag DROP NOT NULL;

ALTER TABLE shopify_integrations
  ADD COLUMN IF NOT EXISTS oauth_connected BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  value_iv TEXT NOT NULL,
  value_auth_tag TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
