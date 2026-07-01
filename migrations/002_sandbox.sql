-- Adds a dedicated sandbox WhatsApp account for the Pedidos & Fulfillment
-- test environment. Real Evolution API calls and real FenixCOD submissions
-- are intercepted in code whenever the conversation belongs to this account.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;

INSERT INTO accounts (instance_name, label, country, is_sandbox, confirmation_enabled)
VALUES ('__sandbox__', 'Sandbox de testes', 'PORTUGAL', true, false)
ON CONFLICT (instance_name) DO NOTHING;
