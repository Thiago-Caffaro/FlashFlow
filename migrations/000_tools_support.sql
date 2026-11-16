-- Adds tools_supported flag to ai_provider_keys.
-- custom_model already exists and is now used by all providers (Gemini/OpenAI/OpenRouter) as their default model.

ALTER TABLE ai_provider_keys
  ADD COLUMN IF NOT EXISTS tools_supported BOOLEAN;
