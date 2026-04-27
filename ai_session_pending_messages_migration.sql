-- Executar no Supabase SQL Editor
-- Adiciona coluna de acumulação de mensagens na tabela ai_sessions

ALTER TABLE public.ai_sessions
  ADD COLUMN IF NOT EXISTS pending_messages TEXT[] NOT NULL DEFAULT '{}';
