-- Shopify per-store message templates
-- Apply after shopify_confirmation_migration.sql

ALTER TABLE shopify_integrations
  ADD COLUMN IF NOT EXISTS confirmation_message_template TEXT,
  ADD COLUMN IF NOT EXISTS recovery_message_template TEXT;
