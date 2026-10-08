# Ambiente local que replica produção

Supabase local com o **schema real de produção** + FlashFlow construído com o
**mesmo `Dockerfile` de produção** + uma **Evolution API simulada com injeção
de falhas**. Serve para reproduzir problemas de mensagens sem depender de
WhatsApp real nem de sorte.

## Recursos

A VM do Docker (WSL2) está limitada em `%USERPROFILE%\.wslconfig` a 2 GB de RAM
e 2 núcleos. Para caber:

- o Supabase sobe só com Postgres, PostgREST, Storage e Kong (sem Studio, Auth,
  Realtime, pg-meta) — ver `up.sh`;
- `flashflow` tem teto de 512 MB / 1 CPU e a Evolution simulada 64 MB;
- a imagem de referência da `main` (para comparação A/B) só sobe na hora do teste.

Precisa do Studio para olhar o banco? `supabase start --workdir dev/local-env`
sem o `-x` (consome ~200 MB a mais).

## Subir

```bash
# 1. Schema de produção (uma vez; não versionado — fica em .gitignore)
supabase db dump --schema public --db-url "<session pooler URL>" -f dev/local-env/supabase/schema.sql

# 2. Tudo (Supabase + schema + migrations 025+ + FlashFlow + Evolution simulada)
dev/local-env/up.sh
```

| Serviço | Endereço |
|---|---|
| FlashFlow | http://localhost:3100 (login: `ADMIN_USERNAME`/`ADMIN_PASSWORD` de `.env.local-env`) |
| Evolution simulada | http://localhost:8090 |
| Supabase (REST/Storage) | http://localhost:54321 · Postgres em `localhost:54322` |

`.env.local-env` é gerado pelo `up.sh` com segredos só deste ambiente — nunca os de produção.

## Evolution simulada (`mock-evolution/server.mjs`)

Implementa as rotas que o FlashFlow chama. Falhas são injetadas por rota:

```bash
# download de mídia devolve 404 / demora 5s / nunca responde
curl -X POST localhost:8090/__config -H 'Content-Type: application/json' -d '{"getBase64FromMediaMessage":{"mode":"error","status":404}}'
curl -X POST localhost:8090/__config -H 'Content-Type: application/json' -d '{"getBase64FromMediaMessage":{"mode":"delay","ms":5000}}'
curl -X POST localhost:8090/__config -H 'Content-Type: application/json' -d '{"getBase64FromMediaMessage":{"mode":"hang"}}'
# eco do WhatsApp chega pelo webhook ANTES da resposta do envio
curl -X POST localhost:8090/__config -H 'Content-Type: application/json' -d '{"sendText":{"echoBeforeResponse":true}}'
curl localhost:8090/__calls      # chamadas recebidas
curl -X POST localhost:8090/__reset
```

## Reprodução A/B

`repro/scenarios.mjs` roda os mesmos cenários contra a versão da `main`
(porta 3101) e a desta branch (3100), no mesmo banco, e compara o resultado:

```bash
# imagem de referência da main (uma vez por mudança na main)
git worktree add --detach ../flashflow-main main
docker build -t flashflow-local:main ../flashflow-main
docker run -d --name flashflow-main-ref --network supabase_network_flashflow-local -p 3101:3000 \
  --env-file dev/local-env/.env.local-env -e SUPABASE_URL=http://supabase_kong_flashflow-local:8000 \
  -e EVOLUTION_API_URL=http://mock-evolution:8080 -e WEBHOOK_BASE_URL=http://flashflow-main-ref:3000 \
  -e COOKIE_SECURE=false --memory 512m --cpus 1 flashflow-local:main

node dev/local-env/repro/scenarios.mjs          # old e new
node dev/local-env/repro/scenarios.mjs new      # só a versão desta branch
docker rm -f flashflow-main-ref                  # libera a memória depois
```

Cenários: mesma imagem entregue duas vezes (número e `@lid`), falha no
download de mídia, mensagem temporária, reação, foto de álbum, histórico
`@lid` na sincronização e eco do envio antes da resposta.

## Logs

`LOG_LEVEL=debug dev/local-env/up.sh` mostra o detalhe de cada evento de
webhook e de cada node de fluxo (em produção fica em `info`).
