-- Lets the AI dynamically look up product catalog, stock and order status
-- mid-conversation via function-calling, independent of whether human
-- escalation is enabled.

ALTER TABLE instance_ai_config ADD COLUMN IF NOT EXISTS fulfillment_tools_enabled BOOLEAN NOT NULL DEFAULT true;
