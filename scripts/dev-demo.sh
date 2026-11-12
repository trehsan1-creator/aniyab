#!/bin/sh
# Demo mode: boots the mock Laya orchestrator (:4100) and Next.js (:3000) together.
# Use this when you have no real LAYA_API_* credentials to hand.
#
#   sh scripts/dev-demo.sh            # streaming mock
#   MOCK_MODE=json sh scripts/dev-demo.sh   # JSON fallback mock
set -e

node scripts/mock-laya.cjs &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null' EXIT INT TERM

MODE="${MOCK_MODE:-stream}"
export LAYA_API_ENDPOINT="${LAYA_API_ENDPOINT:-http://127.0.0.1:4100/${MODE}}"
export LAYA_API_KEY="${LAYA_API_KEY:-mock-dev-key}"

printf 'demo: LAYA_API_ENDPOINT=%s\n' "$LAYA_API_ENDPOINT"
npx next dev -H 0.0.0.0 -p 3000
