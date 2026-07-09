-- Lets a trigger fire when a Shopify order/lead is created, instead of only
-- on an incoming WhatsApp message. Used to replace the old fixed-template
-- order confirmation with a full user-built flow.

ALTER TABLE triggers ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'message';
