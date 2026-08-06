-- 012_fulfillment_delivery_sync.sql
-- Durable polling and status-change outbox for FenixCOD delivery updates.

ALTER TABLE public.fulfillment_integrations
  ADD COLUMN IF NOT EXISTS delivery_sync_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_sync_interval_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS delivery_sync_next_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS delivery_sync_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_sync_locked_by text,
  ADD COLUMN IF NOT EXISTS delivery_sync_last_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_sync_last_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_sync_last_error text,
  ADD COLUMN IF NOT EXISTS delivery_sync_last_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_sync_failures integer NOT NULL DEFAULT 0;

ALTER TABLE public.fulfillment_integrations
  DROP CONSTRAINT IF EXISTS fulfillment_integrations_delivery_sync_interval_check;
ALTER TABLE public.fulfillment_integrations
  ADD CONSTRAINT fulfillment_integrations_delivery_sync_interval_check
  CHECK (delivery_sync_interval_minutes IN (5, 10, 15, 30));

ALTER TABLE public.fulfillment_orders
  ADD COLUMN IF NOT EXISTS external_delivery_status text,
  ADD COLUMN IF NOT EXISTS external_delivery_status_key text,
  ADD COLUMN IF NOT EXISTS delivery_status_source text NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS delivery_status_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_status_sync_error text;

ALTER TABLE public.fulfillment_orders
  DROP CONSTRAINT IF EXISTS fulfillment_orders_delivery_status_source_check;
ALTER TABLE public.fulfillment_orders
  ADD CONSTRAINT fulfillment_orders_delivery_status_source_check
  CHECK (delivery_status_source IN ('local', 'manual', 'flow', 'fenixcod'));

CREATE INDEX IF NOT EXISTS fulfillment_orders_delivery_sync_idx
  ON public.fulfillment_orders (country, lead_number)
  WHERE lead_number IS NOT NULL AND is_simulation = false;

CREATE TABLE IF NOT EXISTS public.fulfillment_delivery_status_mappings (
  external_status_key text PRIMARY KEY,
  external_label text NOT NULL,
  delivery_status text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  seen_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fulfillment_delivery_status_mappings_status_check
    CHECK (delivery_status IS NULL OR delivery_status IN (
      'Não enviado', 'Enviado', 'A caminho', 'Novidade', 'Rejeitado', 'Entregue'
    ))
);

INSERT INTO public.fulfillment_delivery_status_mappings
  (external_status_key, external_label, delivery_status)
VALUES
  ('unpacked', 'unpacked', 'Não enviado'),
  ('new order', 'new order', 'Não enviado'),
  ('pending', 'pending', 'Não enviado'),
  ('not shipped', 'not shipped', 'Não enviado'),
  ('nao enviado', 'não enviado', 'Não enviado'),
  ('no enviado', 'no enviado', 'Não enviado'),
  ('non expedie', 'non expédié', 'Não enviado'),
  ('packed', 'packed', 'Enviado'),
  ('sent', 'sent', 'Enviado'),
  ('shipped', 'shipped', 'Enviado'),
  ('dispatched', 'dispatched', 'Enviado'),
  ('enviado', 'enviado', 'Enviado'),
  ('expedie', 'expédié', 'Enviado'),
  ('in transit', 'in transit', 'A caminho'),
  ('on the way', 'on the way', 'A caminho'),
  ('out for delivery', 'out for delivery', 'A caminho'),
  ('a caminho', 'a caminho', 'A caminho'),
  ('em transito', 'em trânsito', 'A caminho'),
  ('en transito', 'en tránsito', 'A caminho'),
  ('novelty', 'novelty', 'Novidade'),
  ('exception', 'exception', 'Novidade'),
  ('incident', 'incident', 'Novidade'),
  ('novidade', 'novidade', 'Novidade'),
  ('incidencia', 'incidência', 'Novidade'),
  ('rejected', 'rejected', 'Rejeitado'),
  ('refused', 'refused', 'Rejeitado'),
  ('returned', 'returned', 'Rejeitado'),
  ('cancelled', 'cancelled', 'Rejeitado'),
  ('canceled', 'canceled', 'Rejeitado'),
  ('rejeitado', 'rejeitado', 'Rejeitado'),
  ('recusado', 'recusado', 'Rejeitado'),
  ('rechazado', 'rechazado', 'Rejeitado'),
  ('refuse', 'refusé', 'Rejeitado'),
  ('retourne', 'retourné', 'Rejeitado'),
  ('delivered', 'delivered', 'Entregue'),
  ('entregue', 'entregue', 'Entregue'),
  ('entregado', 'entregado', 'Entregue'),
  ('livre', 'livré', 'Entregue')
ON CONFLICT (external_status_key) DO NOTHING;

ALTER TABLE public.flow_jobs
  DROP CONSTRAINT IF EXISTS flow_jobs_job_type_check;
ALTER TABLE public.flow_jobs
  ADD CONSTRAINT flow_jobs_job_type_check
  CHECK (job_type IN ('shopify_order_flow', 'flow_message_resume', 'delivery_status_flow'));

CREATE OR REPLACE FUNCTION public.claim_fulfillment_delivery_sync(
  p_worker_id text,
  p_limit integer DEFAULT 1,
  p_integration_id uuid DEFAULT NULL,
  p_force boolean DEFAULT false
)
RETURNS TABLE (
  integration_id uuid,
  country text,
  interval_minutes integer,
  worker_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT integrations.id
    FROM public.fulfillment_integrations AS integrations
    WHERE integrations.active = true
      AND (p_integration_id IS NULL OR integrations.id = p_integration_id)
      AND (
        p_force = true
        OR (
          integrations.delivery_sync_enabled = true
          AND integrations.delivery_sync_next_at <= now()
        )
      )
      AND (
        integrations.delivery_sync_locked_at IS NULL
        OR integrations.delivery_sync_locked_at < now() - interval '15 minutes'
      )
    ORDER BY integrations.delivery_sync_next_at, integrations.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 1), 5))
  )
  UPDATE public.fulfillment_integrations AS integrations
  SET
    delivery_sync_locked_at = now(),
    delivery_sync_locked_by = p_worker_id,
    delivery_sync_last_started_at = now(),
    updated_at = now()
  FROM candidates
  WHERE integrations.id = candidates.id
  RETURNING
    integrations.id,
    integrations.country,
    integrations.delivery_sync_interval_minutes,
    integrations.delivery_sync_locked_by;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_fulfillment_delivery_status(
  p_external_status_key text,
  p_external_label text
)
RETURNS SETOF public.fulfillment_delivery_status_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.fulfillment_delivery_status_mappings AS mappings (
    external_status_key,
    external_label,
    seen_count
  )
  VALUES (
    p_external_status_key,
    left(p_external_label, 200),
    1
  )
  ON CONFLICT (external_status_key) DO UPDATE
  SET
    external_label = EXCLUDED.external_label,
    last_seen_at = now(),
    seen_count = mappings.seen_count + 1,
    updated_at = now()
  RETURNING mappings.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_fulfillment_delivery_status(
  p_order_id uuid,
  p_delivery_status text,
  p_external_status text,
  p_external_status_key text,
  p_external_occurred_at timestamptz DEFAULT NULL,
  p_external_snapshot jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  changed boolean,
  event_id uuid,
  previous_status text,
  current_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_row public.fulfillment_orders%ROWTYPE;
  status_changed boolean;
  new_event_id uuid;
  trigger_instance text;
BEGIN
  IF p_delivery_status NOT IN (
    'Não enviado', 'Enviado', 'A caminho', 'Novidade', 'Rejeitado', 'Entregue'
  ) THEN
    RAISE EXCEPTION 'Status de entrega interno inválido';
  END IF;

  SELECT * INTO order_row
  FROM public.fulfillment_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;
  IF order_row.is_simulation = true THEN
    RAISE EXCEPTION 'Pedido de simulação não pode ser sincronizado';
  END IF;
  IF order_row.lead_number IS NULL THEN
    RAISE EXCEPTION 'Pedido sem lead_number';
  END IF;

  status_changed := order_row.delivery_status IS DISTINCT FROM p_delivery_status;
  trigger_instance := coalesce(
    nullif(order_row.assigned_instance_name, ''),
    nullif(order_row.instance_name, '')
  );

  UPDATE public.fulfillment_orders
  SET
    delivery_status = p_delivery_status,
    external_delivery_status = left(p_external_status, 200),
    external_delivery_status_key = p_external_status_key,
    delivery_status_source = 'fenixcod',
    delivery_status_synced_at = now(),
    delivery_status_changed_at = CASE
      WHEN status_changed THEN coalesce(p_external_occurred_at, now())
      ELSE delivery_status_changed_at
    END,
    delivery_status_sync_error = NULL,
    external_snapshot = coalesce(p_external_snapshot, '{}'::jsonb),
    updated_at = now()
  WHERE id = p_order_id;

  IF status_changed THEN
    INSERT INTO public.fulfillment_order_events (order_id, event_type, payload)
    VALUES (
      p_order_id,
      'delivery_status_changed',
      jsonb_build_object(
        'previous_status', order_row.delivery_status,
        'delivery_status', p_delivery_status,
        'external_status', left(p_external_status, 200),
        'external_occurred_at', p_external_occurred_at,
        'source', 'fenixcod'
      )
    )
    RETURNING id INTO new_event_id;

    IF trigger_instance IS NOT NULL THEN
      INSERT INTO public.flow_jobs (
        job_type,
        dedupe_key,
        instance_name,
        flow_id,
        node_id,
        order_id,
        conversation_id,
        remote_jid,
        payload,
        max_attempts,
        next_attempt_at,
        expires_at
      )
      SELECT
        'delivery_status_flow',
        'delivery-status:' || new_event_id::text || ':' || triggers.id::text,
        trigger_instance,
        flows.id,
        NULL,
        p_order_id,
        order_row.conversation_id,
        NULL,
        jsonb_build_object(
          'triggerId', triggers.id,
          'eventId', new_event_id,
          'previousStatus', order_row.delivery_status,
          'deliveryStatus', p_delivery_status
        ),
        10,
        now() + make_interval(secs => greatest(coalesce(triggers.delay_ms, 0), 0)::double precision / 1000),
        now() + interval '24 hours'
      FROM public.triggers AS triggers
      JOIN public.flows AS flows
        ON flows.id::text = triggers.action_payload->>'flow_id'
        AND flows.instance_name = trigger_instance
      WHERE triggers.instance_name = trigger_instance
        AND triggers.source = 'delivery_status'
        AND triggers.action = 'flow'
        AND (
          coalesce(triggers.action_payload->'statuses', '[]'::jsonb) ? p_delivery_status
          OR coalesce(triggers.action_payload->'statuses', '[]'::jsonb) ? '*'
        )
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
  END IF;

  RETURN QUERY SELECT
    status_changed,
    new_event_id,
    order_row.delivery_status,
    p_delivery_status;
END;
$$;

ALTER TABLE public.fulfillment_delivery_status_mappings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.fulfillment_delivery_status_mappings FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_fulfillment_delivery_sync(text, integer, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_fulfillment_delivery_status(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_fulfillment_delivery_status(uuid, text, text, text, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.fulfillment_delivery_status_mappings TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_fulfillment_delivery_sync(text, integer, uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_fulfillment_delivery_status(text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_fulfillment_delivery_status(uuid, text, text, text, timestamptz, jsonb)
  TO service_role;
