<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# FlashFlow Agent Guide

## Project

FlashFlow is a WhatsApp customer-service and automation application. It includes
multi-account chat, visual conversation flows, AI-assisted sessions, diagnostics,
authentication, and Shopify/FenixCOD fulfillment integrations.

The application is actively evolving. Treat the source code, database migrations,
and current tests as authoritative when older documentation disagrees with them.
`PROJECT_CONTEXT.md` at the repo root is a generated, verified snapshot of the
current architecture, critical flows (with file:line citations), and business
rules — regenerate it after structural changes instead of trusting older docs.

## Stack

- Next.js 16 App Router with React 19 and TypeScript
- Tailwind CSS 4 and shadcn/ui
- Supabase PostgreSQL and Realtime
- WhatsApp: both Evolution API (self-hosted) and WhatsApp Cloud API (official),
  side by side per account
- xyflow for the visual flow builder, with a custom execution engine (`lib/flow-engine.ts`)
- Multi-provider AI (Gemini, OpenAI, OpenRouter) inside flow nodes
- Jest and ts-jest for tests

Local development selects its Evolution API and webhook callback through
`.env.development.local`. Socket.IO integration is opt-in with
`EVOLUTION_SOCKET_ENABLED=true`; Evolution API v2.3.7 does not expose the
Socket.IO endpoint.

## Important Paths

- `app/`: pages and API route handlers
- `components/`: feature and UI components
- `components/flows/`: visual flow builder
- `lib/flow-engine.ts`: flow execution logic
- `lib/supabase.ts`: browser-safe Supabase client
- `lib/supabase-admin.ts`: server-only privileged Supabase client
- `types/index.ts`: shared application types
- `__tests__/`: Jest tests
- `migrations/NNN_description.sql`: database migrations, numbered — note that
  foundational tables (`conversations`, `messages`, `accounts`, `flows`,
  `triggers`, `ai_sessions`...) predate this directory and have no `CREATE
  TABLE` here, only later `ALTER TABLE`s
- `PROJECT_CONTEXT.md`: generated project context (architecture, flows, business rules)

## Development Rules

- Before changing Next.js APIs or conventions, read the relevant documentation
  under `node_modules/next/dist/docs/`.
- Preserve the existing App Router structure and local coding patterns.
- Keep privileged credentials and `supabaseAdmin` in server-only code.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` or other server secrets to client code.
- API routes should validate input, handle failures explicitly, and return JSON
  responses with appropriate HTTP status codes.
- Avoid `any`; use existing shared types or add precise types.
- Use Tailwind for styling and reuse existing UI components where practical.
- Add or update focused tests for behavior changes.
- Do not edit generated or local-only files such as `.next/`, coverage output,
  `.env*`, `.claude/settings.local.json`, logs, or Windows Zone Identifier files.

## Verification

Run the checks relevant to the change:

```bash
npm test
npx tsc --noEmit
npm run build
```

The build can require configured environment variables and external services.
Report clearly when a check cannot run for that reason.

## Git Hygiene

- Work on the current feature branch; do not push unless explicitly requested.
- Do not commit local credentials, logs, agent-specific local settings, or
  operating-system metadata.
- Do not revert unrelated user changes in a dirty working tree.
