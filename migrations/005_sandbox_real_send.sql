-- Lets a sandbox test contact imported from a real connected account
-- actually receive WhatsApp messages for real (routed through that real
-- account), instead of every sandbox send being intercepted unconditionally.
-- Manually-typed test contacts have no source account, so they can never
-- be enabled for real sends.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sandbox_source_instance TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sandbox_real_send_enabled BOOLEAN NOT NULL DEFAULT false;
