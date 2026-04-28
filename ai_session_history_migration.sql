-- Executar no Supabase SQL Editor
-- Adiciona histórico de conversa da sessão em ai_sessions

ALTER TABLE public.ai_sessions
  ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]';
