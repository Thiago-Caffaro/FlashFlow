#!/usr/bin/env bash
# Sobe o ambiente local que replica produção (Supabase + FlashFlow + Evolution simulada).
# Pré-requisitos: Docker rodando e Supabase CLI instalada.
set -euo pipefail
cd "$(dirname "$0")"

if ! docker ps --format '{{.Names}}' | grep -q '^supabase_db_flashflow-local$'; then
  # gotrue fica ligado: sem ele o `supabase status` não devolve ANON_KEY/SERVICE_ROLE_KEY.
  supabase start --workdir . -x edge-runtime,logflare,vector,inbucket,mailpit,imgproxy,supavisor,studio,realtime,postgres-meta
fi

# Schema de produção (gere com: supabase db dump --schema public --db-url "<session pooler>" -f supabase/schema.sql)
if [ -f supabase/schema.sql ]; then
  tables=$(docker exec supabase_db_flashflow-local psql -U postgres -d postgres -tAc "select count(*) from information_schema.tables where table_schema='public' and table_name='messages'")
  if [ "$tables" = "0" ]; then
    echo "Aplicando schema de produção…"
    docker exec -i supabase_db_flashflow-local psql -U postgres -d postgres -q < supabase/schema.sql
    for migration in ../../migrations/02[5-9]_*.sql; do
      [ -f "$migration" ] && docker exec -i supabase_db_flashflow-local psql -U postgres -d postgres -q < "$migration"
    done
  fi
else
  echo "Aviso: supabase/schema.sql não encontrado — o banco local fica vazio." >&2
fi

eval "$(supabase status --workdir . -o env 2>/dev/null | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=')"

# Segredos só deste ambiente local (nunca os de produção).
cat > .env.local-env <<EOF
ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
EVOLUTION_API_KEY=local-evolution-key
EVOLUTION_WEBHOOK_SECRET=local-webhook-secret
AUTH_SECRET=local-auth-secret-$(date +%s)-change-me-0123456789abcdef
AI_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ADMIN_USERNAME=admin
ADMIN_PASSWORD=local-admin-password
EOF

export ANON_KEY
docker compose --env-file .env.local-env up -d --build "$@"
echo "FlashFlow: http://localhost:3100   Evolution simulada: http://localhost:8090   Studio: http://localhost:54323"
