# @agent-lab/web

Next.js 15 (App Router) + Cloudflare D1 + Tailwind — Phase 1 MVP for agent-lab.
Serves the platform API and the Radar board UI.

> Phase 1 ships a minimal usable experience. Phase 2 will redesign the UI and
> wire up the real GLM LLM; do not over-polish things here.

## Prerequisites

- Node.js >= 20, pnpm >= 10 (root workspace)
- From the repo root: `pnpm install` (installs this package too)

## First-time setup

```bash
# from repo root
pnpm install

# initialize local D1 (runs migrations/0001_init.sql in wrangler --local mode)
bash apps/web/scripts/init-local-db.sh
```

The local D1 state lives under `apps/web/.wrangler/state/` (gitignored).

Secrets for local dev are in `apps/web/.dev.vars` (gitignored). Defaults:

```
RADAR_WRITE_TOKEN=dev-radar-token-change-me
RADAR_AGENT_BASE=http://127.0.0.1:8001
```

## Running (dev)

```bash
# from repo root
pnpm dev:web
# or
cd apps/web && pnpm dev
```

Server: http://127.0.0.1:8788

Dev mode uses `next dev` with `@cloudflare/next-on-pages/next-dev`, which wires
`getRequestContext().env` to the D1 binding and vars declared in
`wrangler.toml` / `.dev.vars`.

## Build & preview (Cloudflare Pages)

```bash
pnpm --filter @agent-lab/web pages:build   # next-on-pages → .vercel/output/static
pnpm --filter @agent-lab/web preview       # wrangler pages dev on :8788
```

## API

Base URL: `http://127.0.0.1:8788`

| Method | Path                              | Auth                     | Notes |
|--------|-----------------------------------|--------------------------|-------|
| POST   | `/api/items/batch`                | `Bearer ${RADAR_WRITE_TOKEN}` | Idempotent on `external_id`. Body: `{ round_at, items[] }`. Returns `{ ok, inserted, skipped }`. |
| GET    | `/api/items?agent_id=&grade=&since=&limit=` | —              | Defaults: `agent_id=radar`, `limit=200`. Joins `user_states` (user_id=`default_user`); each item includes `status`. |
| GET    | `/api/items/:id`                  | —                        | Single item with status. |
| PATCH  | `/api/items/:id/state`            | —                        | Body: `{ status }`. Upserts `user_states`. |
| POST   | `/api/chat`                       | —                        | Body: `{ item_id, session_id?, message }`. Streams SSE. Forwards to `${RADAR_AGENT_BASE}/chat`; falls back to a mock stream if the agent is down. Persists to `chat_sessions` / `chat_messages`. |
| GET    | `/api/chat/sessions/:itemId`      | —                        | Latest session + messages for that item. |

### SSE format on `/api/chat`

Each event is a `data: <json>` line, terminated by `data: [DONE]`.
Two event types:

```
data: {"type":"session","session_id":"<uuid>"}
data: {"type":"delta","content":"<partial text>"}
...
data: [DONE]
```

Mock fallback sends the fixed string
`[mock] 这是一条假回复,Phase 2 接真 LLM 后会变成 GLM 的输出。` in ~6-char chunks
every 100ms.

## Pages

- `/` — minimal landing with a card linking to Radar.
- `/agents/radar` — the Radar board. CSS ported from
  `~/.openclaw/workspace-radar/radar-board.html`. Reads from `/api/items`,
  state buttons call `PATCH /api/items/:id/state` with localStorage as a
  network fallback. A `💬 追问` button opens the chat drawer (SSE streaming).
  The drawer shows a small line "Phase 2 将重做 UI".

## Quick smoke test

```bash
# insert two items (idempotent)
curl -s -X POST http://127.0.0.1:8788/api/items/batch \
  -H "Authorization: Bearer dev-radar-token-change-me" \
  -H "Content-Type: application/json" \
  -d '{"round_at":"2026-04-09T10:00:00Z","items":[
    {"external_id":"test-001","agent_id":"radar","item_type":"recommendation",
     "grade":"fire","title":"hello","summary":"hi","round_at":"2026-04-09T10:00:00Z"}
  ]}'
# → {"ok":true,"inserted":1,"skipped":0}

curl -s 'http://127.0.0.1:8788/api/items?agent_id=radar'

# chat stream (agent offline → mock)
curl -sN -X POST http://127.0.0.1:8788/api/chat \
  -H "Content-Type: application/json" \
  -d '{"item_id":null,"message":"hello"}'
```

## File layout

```
apps/web/
  migrations/0001_init.sql         # D1 schema (managed by Phase 0)
  wrangler.toml                    # Pages + D1 binding
  .dev.vars                        # local secrets (gitignored)
  scripts/init-local-db.sh         # runs the migration against local D1
  src/
    app/
      layout.tsx
      page.tsx                     # /
      globals.css
      agents/radar/
        page.tsx                   # /agents/radar (server wrapper)
        RadarBoard.tsx             # client component
        ChatDrawer.tsx             # SSE drawer
        radar.css                  # styles ported from radar-board.html
      api/
        items/route.ts             # GET /api/items
        items/[id]/route.ts        # GET /api/items/:id
        items/[id]/state/route.ts  # PATCH /api/items/:id/state
        items/batch/route.ts       # POST /api/items/batch
        chat/route.ts              # POST /api/chat (SSE)
        chat/sessions/[itemId]/route.ts  # GET session history
    lib/
      env.ts                       # getEnv() via getRequestContext
      items.ts                     # D1 queries for items
      chat.ts                      # D1 queries for chat_sessions/messages
      types.ts                     # re-exports @agent-lab/types
```

## Deviations from brief (worth knowing)

- **Drizzle was dropped**. Phase 1 uses raw `env.DB.prepare(...)` with typed
  row interfaces in `src/lib/items.ts` and `src/lib/chat.ts`. Rationale: the
  query surface is tiny (~6 queries), Drizzle's D1 driver adds setup overhead
  that exceeds its value for Phase 1. Upgrade to Drizzle when the query
  count or complexity justifies it.
- **Tailwind is installed but barely used**. The Radar page intentionally
  mirrors the original `radar-board.html` CSS verbatim (via `radar.css`) so
  visual parity with the current board is preserved. Tailwind is reserved for
  new components (home page, drawer layout helpers).
- **No `/api/chat` auth**. The brief didn't require one; if the frontend is
  public, add a bearer token later.

## Todo / suggestions for Phase 0 → Phase 1 bridge

- `packages/types` does not yet build as a real package (no tsconfig / no
  dist). It's consumed via `main: src/index.ts` + `transpilePackages` in
  `next.config.mjs`, which works. If/when it grows, add a proper build.
- The `.env.example` is at repo root but this app reads `.dev.vars` for
  wrangler-managed secrets. That's intentional (Cloudflare Pages convention),
  just a heads-up for future devs.
