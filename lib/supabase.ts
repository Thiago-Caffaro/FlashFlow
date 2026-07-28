import { createClient } from '@supabase/supabase-js'

// ATENÇÃO: cliente com a chave anônima (pública, embutida no bundle do
// navegador). As tabelas da aplicação não têm RLS que restrinja o papel
// "anon" (ver migrations/008_lockdown_anon_rls.sql) — qualquer leitura ou
// Realtime feito com este cliente expõe dados de TODAS as instâncias/contas
// para qualquer pessoa com acesso ao bundle. Não use para conversations,
// messages, ai_sessions, flows, integrações ou qualquer outra tabela privada.
// Toda leitura/escrita de dados privados deve passar por uma API route
// autenticada (proxy.ts) usando supabaseAdmin (service role).
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
