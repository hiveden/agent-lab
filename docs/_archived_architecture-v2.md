# Radar UI v2 — Architecture & Tech Stack

## Current State Diagnosis

| Dimension | Current | Problem |
|-----------|---------|---------|
| **State Management** | RadarWorkspace 825 lines, 18 useState, 22+ props drilling to InboxView | God component, bloats with every feature |
| **CSS** | Tailwind installed but barely used, 1800 lines flat globals.css | Class collision risk, no co-location |
| **Data Fetching** | Manual fetch + useEffect, no cache/dedup | Duplicate requests on tab switch, no optimistic update framework |
| **Drag/Resize** | 3x handwritten mousedown/mousemove/mouseup | No touch support, duplicated code |
| **Visualization** | FunnelView/AttentionView pure CSS divs | Cannot do funnel charts, trend lines |
| **Component Library** | All handwritten (button, input, dialog, toast) | No consistency guarantee, reinventing wheels |

## Target Architecture

```
┌─────────────────────────────────────────────────┐
│                  RadarWorkspace                  │
│  (routing shell: view switch + command palette)  │
│                                                  │
│  ┌─── Zustand Store ──────────────────────────┐ │
│  │ radarStore: items, filter, selectedId,      │ │
│  │   pending, sessions, trace, chatHeight...   │ │
│  │ actions: select, markPending, applyPending  │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  ┌─ Views ──────────────────────────────────────┐│
│  │ InboxView  │ RunsView  │ SourcesView  │ ... ││
│  │ (read from store directly, no props)         ││
│  └──────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

## Tech Stack Selection

| Need | Choice | Rationale |
|------|--------|-----------|
| **State Management** | **Zustand** | Lightest (1KB), slice pattern for splitting, persist middleware replaces handwritten localStorage |
| **Data Fetching** | **SWR** | Same team as Next.js, pairs well with App Router, lighter than React Query, sufficient |
| **Component Library** | **shadcn/ui** | Source-copied not npm-installed, full control; Radix-based accessibility; Tailwind-native |
| **Resizable Panels** | **react-resizable-panels** | Purpose-built for panel splitting, touch/keyboard/persist support, replaces 3x handwritten code |
| **Visualization** | **recharts** | React-native, Bar/Funnel/Line support, ~50KB, sufficient for Runs funnel + Attention deviation |
| **CSS** | **Tailwind (existing) + cn() utility** | shadcn/ui standard, `clsx` + `tailwind-merge` combo |

### Not Chosen

- **React Query** — heavier than SWR, mutation management not needed here
- **Jotai** — atomic model too fragmented for medium-scale app
- **CSS Modules** — conflicts with Tailwind philosophy, go all-in Tailwind instead
- **D3/Visx** — overkill, recharts sufficient

## Execution Plan

### Track A: State & Data Layer (sequential, foundation)

**A1: Zustand store extraction**
- Create `apps/web/src/lib/stores/radar-store.ts`
- Slices: `items`, `ui` (view/filter/selected), `trace`, `sessions`, `pending`
- Persist middleware for localStorage keys
- Migrate RadarWorkspace useState → store
- Each view component reads from store directly

**A2: SWR data fetching**
- Create `apps/web/src/lib/hooks/use-items.ts`, `use-runs.ts`, `use-sources.ts`, `use-attention.ts`
- Replace manual fetch + useEffect with `useSWR`
- Mutate cache on optimistic updates
- SSE streaming stays manual (SWR doesn't handle SSE)

### Track B: Component Infrastructure (parallel with A)

**B1: shadcn/ui bootstrap**
- `npx shadcn@latest init` (configure Tailwind, cn() utility)
- Install base components: Button, Tabs, Command, Dialog, Toast, Badge
- Replace handwritten equivalents

**B2: Tailwind migration**
- Migrate globals.css classes → Tailwind utilities in JSX
- Keep CSS variables as design tokens in `@layer base`
- Target: globals.css < 200 lines (tokens + keyframes only)

**B3: react-resizable-panels**
- Replace 3x handwritten drag logic (list width, chat height, trace width)
- Panel persist via Zustand store

### Track C: Feature Completion (after A1 + B1)

**C1: Trigger Collection button**
- Topbar: primary "Trigger" button → calls triggerRadarPush
- Runs sidebar header: secondary "Trigger" button
- Both show progress in Runs view with SSE trace

**C2: Run Detail enrichment**
- Per-source breakdown rows (source icon + name + count + time)
- recharts funnel (Fetched → Promoted / Rejected)
- Promoted items list with grade dots

**C3: Sources card grid**
- Replace table with card grid (matching prototype)
- Verified status dot + last collection time
- Weight progress bar
- "+ Add Source" flow

### Dependency Graph

```
A1 (Zustand) ──┬──→ A2 (SWR) ──→ C1 (Trigger)     ✅ all done
               │                  ──→ C2 (Run Detail) ✅
               │                  ──→ C3 (Sources Cards) ✅
B1 (shadcn) ──┤
B2 (Tailwind) ─┤  ← remaining
B3 (Panels) ───┘
```

**Status (2026-04-12):** A1, A2, B1, B3, C1, C2, C3 complete. 17/17 E2E passing.
B2 (Tailwind migration of 1800+ line globals.css) is the remaining infrastructure task.
