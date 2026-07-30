-- 009_message_variables_and_flow_jobs.sql
-- Durable message variables and serialized flow execution jobs.

CREATE TABLE IF NOT EXISTS public.message_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name text NOT NULL,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,47}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  value text NOT NULL CHECK (char_length(value) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_name, key)
);

CREATE INDEX IF NOT EXISTS message_variables_instance_idx
  ON public.message_variables (instance_name, key);

CREATE TABLE IF NOT EXISTS public.flow_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN ('shopify_order_flow', 'flow_message_resume')),
  dedupe_key text UNIQUE,
  instance_name text NOT NULL,
  flow_id uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  node_id text,
  order_id uuid REFERENCES public.fulfillment_orders(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  remote_jid text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 20 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS flow_jobs_claim_idx
  ON public.flow_jobs (status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS public.flow_worker_state (
  key text PRIMARY KEY,
  last_send_at timestamptz NOT NULL DEFAULT to_timestamp(0)
);

INSERT INTO public.flow_worker_state (key)
VALUES ('confirmation_send')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_flow_jobs(
  p_worker_id text,
  p_limit integer DEFAULT 1
)
RETURNS SETOF public.flow_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.flow_jobs
  SET
    status = 'failed',
    locked_at = null,
    locked_by = null,
    last_error = coalesce(last_error, 'Tempo limite do job excedido'),
    updated_at = now()
  WHERE
    status IN ('pending', 'processing')
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.flow_jobs
    WHERE
      (
        status = 'pending'
        OR (
          status = 'processing'
          AND locked_at < now() - interval '2 minutes'
        )
      )
      AND next_attempt_at <= now()
      AND (expires_at IS NULL OR expires_at > now())
      AND attempts < max_attempts
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 1), 10))
  )
  UPDATE public.flow_jobs AS jobs
  SET
    status = 'processing',
    attempts = jobs.attempts + 1,
    locked_at = now(),
    locked_by = p_worker_id,
    updated_at = now()
  FROM candidates
  WHERE jobs.id = candidates.id
  RETURNING jobs.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_flow_send_slot(
  p_key text DEFAULT 'confirmation_send',
  p_gap_ms integer DEFAULT 1500
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reserved_at timestamptz;
BEGIN
  INSERT INTO public.flow_worker_state (key)
  VALUES (p_key)
  ON CONFLICT (key) DO NOTHING;

  SELECT greatest(
    now(),
    last_send_at + make_interval(secs => greatest(p_gap_ms, 0)::double precision / 1000)
  )
  INTO reserved_at
  FROM public.flow_worker_state
  WHERE key = p_key
  FOR UPDATE;

  UPDATE public.flow_worker_state
  SET last_send_at = reserved_at
  WHERE key = p_key;

  RETURN reserved_at;
END;
$$;

ALTER TABLE public.message_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_worker_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.message_variables FROM anon, authenticated;
REVOKE ALL ON TABLE public.flow_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE public.flow_worker_state FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_flow_jobs(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_flow_send_slot(text, integer) FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.message_variables TO service_role;
GRANT ALL ON TABLE public.flow_jobs TO service_role;
GRANT ALL ON TABLE public.flow_worker_state TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_flow_jobs(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_flow_send_slot(text, integer) TO service_role;
