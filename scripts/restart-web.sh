#!/bin/bash
# Kill old dev server, clean cache, restart
lsof -ti :8788 | xargs kill -9 2>/dev/null
sleep 1
rm -rf apps/web/.next
pnpm dev:web
