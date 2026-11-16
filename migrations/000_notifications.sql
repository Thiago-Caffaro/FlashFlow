-- Adds escalation/notification support to AI sessions and config

ALTER TABLE ai_sessions
  ADD COLUMN IF NOT EXISTS requires_human BOOLEAN DEFAULT FALSE;

ALTER TABLE instance_ai_config
  ADD COLUMN IF NOT EXISTS escalation_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS escalation_stop_on_obstacle BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS escalation_base_prompt TEXT;
