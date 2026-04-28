-- Executar no Supabase SQL Editor
-- Cria a tabela de blocos de memória para agentes de IA

CREATE TABLE IF NOT EXISTS public.agent_memory_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'always' CHECK (type IN ('always', 'contextual')),
  keywords TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_blocks_instance
  ON public.agent_memory_blocks (instance_name);
