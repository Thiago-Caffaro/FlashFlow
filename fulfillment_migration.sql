-- European Fulfilment integration

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS country TEXT;

CREATE TABLE IF NOT EXISTS fulfillment_integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  country TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('test', 'production')),
  encrypted_email TEXT NOT NULL,
  email_iv TEXT NOT NULL,
  email_auth_tag TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  password_iv TEXT NOT NULL,
  password_auth_tag TEXT NOT NULL,
  encrypted_token TEXT,
  token_iv TEXT,
  token_auth_tag TEXT,
  token_expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fulfillment_products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  country TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(country, sku)
);

CREATE TABLE IF NOT EXISTS fulfillment_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  lead_number TEXT UNIQUE,
  instance_name TEXT NOT NULL,
  country TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contact_phone TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  province TEXT NOT NULL,
  zipcode TEXT NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('COD', 'PREPAID')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'pending_operator',
  external_snapshot JSONB,
  last_error TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fulfillment_orders_conversation_idx
  ON fulfillment_orders(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fulfillment_orders_instance_idx
  ON fulfillment_orders(instance_name, created_at DESC);

CREATE TABLE IF NOT EXISTS fulfillment_order_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES fulfillment_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flow_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_name TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  node_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(instance_name, remote_jid)
);
