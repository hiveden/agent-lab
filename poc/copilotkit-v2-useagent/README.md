# copilotkit-v2-useagent-poc

Standalone Next.js 15 app that validates `@copilotkit/react-core/v2`'s `useAgent` hook against the agent-lab BFF SSE passthrough.

> Background: [`docs/mobile-playbook/11-poc-copilotkit-v2.md`](../../docs/mobile-playbook/11-poc-copilotkit-v2.md).
> This directory is **intentionally outside the pnpm workspace** — it has its own `node_modules` and lockfile and never imports anything from `apps/web`.

## Prerequisites

Both backends must be running before you open the page.

| Service | Command | Port |
|---|---|---|
| agent-lab BFF (Next.js) | `pnpm dev:web` (from repo root) | `:8788` |
| Python Agent Server | `cd agents/radar && uv run radar-serve` | `:8001` |

Optional observability stack (for Phase D — trace_id verification):

```
bash docker/start-all.sh        # SigNoz :3301, Langfuse :3010, Collector :4317/:4318
```

## Install & run

```bash
cd poc/copilotkit-v2-useagent
pnpm install --ignore-workspace
pnpm dev
# open http://localhost:3005
```

`--ignore-workspace` is required: the repo root has a `pnpm-workspace.yaml` that
would otherwise try to adopt this directory and hoist deps into the wrong
`node_modules`, breaking the "independent skeleton" property.

## Env

Defaults to `NEXT_PUBLIC_COPILOT_RUNTIME_URL=http://localhost:8788/api/agent/chat`.
Override via `.env.local` if you want to hit `agents/radar` directly:

```
# .env.local
NEXT_PUBLIC_COPILOT_RUNTIME_URL=http://localhost:8001/agent/chat
```

## Scope

**In:**
- Minimal `<CopilotKit>` + `useAgent('radar')` wiring (v2 subpath)
- Input + message list rendered from the hook's state
- Live `<pre>` dump of `{ isRunning, toolCalls, messages }` for Phase D evidence

**Out (intentionally):**
- UI polish / component libraries (headless, inline styles only)
- OTel SDK — wired in Phase C after Worker B delivers `otel-snippet.ts`
- Auth / cookies / DB
- Build + deploy

## Issue #32 guardrails

The lesson from `#32` is that unstable `<CopilotKit>` props (fresh `{}` refs every
render) retrigger the agents-sync effect and clobber subscriptions. To stay safe:

- `headers` / `properties` passed to `<CopilotKit>` are module-level
  `Object.freeze({})` in [`app/providers.tsx`](./app/providers.tsx).
- `useAgent(...)` options are wrapped in `useMemo(() => ({...}), [])` in
  [`app/page.tsx`](./app/page.tsx), and their inner object refs are also module-level.

If you add new props, keep them referentially stable. Do **not** inline `{}` or
`[]` literals into JSX / hook args.

## Files

```
poc/copilotkit-v2-useagent/
├─ package.json            # name: copilotkit-v2-useagent-poc, private, not in workspace
├─ tsconfig.json
├─ next.config.ts
├─ next-env.d.ts
├─ .gitignore
├─ README.md
└─ app/
   ├─ layout.tsx           # <html>/<body> + <Providers>
   ├─ providers.tsx        # <CopilotKit runtimeUrl=... headers=EMPTY properties=EMPTY>
   └─ page.tsx             # useAgent('radar') + input + messages + <pre>{state}</pre>
```

## Next steps

1. Phase B (Worker B): drop in `otel-snippet.ts` → `app/otel-init.tsx` + wire in `layout.tsx`.
2. Phase C (human): `pnpm dev`, send a message, confirm streaming round-trip.
3. Phase D (human): walk V1–V7 from the playbook, fill `VERDICT.md`.

Archive on PASS: `tar czf docs/checkpoints/poc-copilotkit-v2.tar.gz poc/copilotkit-v2-useagent/`.
