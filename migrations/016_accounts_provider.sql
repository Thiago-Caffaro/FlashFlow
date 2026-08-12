-- 016_accounts_provider.sql
-- Identifica qual provedor de envio/recebimento uma conta usa. Aditivo: toda
-- linha existente assume 'evolution' automaticamente, nenhuma migração de
-- dados manual necessária. Fundação para o suporte à WhatsApp Cloud API
-- (Meta) como segundo provedor, mantido em paralelo com a Evolution API.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'evolution';

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_provider_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_provider_check
  CHECK (provider IN ('evolution', 'cloud_api'));
