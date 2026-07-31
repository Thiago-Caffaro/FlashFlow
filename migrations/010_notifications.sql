-- 010_notifications.sql
-- Persistent operator notifications emitted by escalations and flow nodes.

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name text NOT NULL,
  type text NOT NULL CHECK (type IN ('flow', 'escalation')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  flow_id uuid REFERENCES public.flows(id) ON DELETE SET NULL,
  flow_node_id text,
  source_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_name, source_key)
);

CREATE INDEX IF NOT EXISTS notifications_instance_created_idx
  ON public.notifications (instance_name, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_instance_unread_idx
  ON public.notifications (instance_name, read_at, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notifications FROM anon, authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;
