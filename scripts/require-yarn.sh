#!/bin/sh
# Nx (via `lerna run`) spawns every task as bare `yarn run <target>` — it detects the
# package manager from yarn.lock/packageManager and ignores lerna.json's npmClient.
# Without a global yarn shim all 51 builds fail with a cryptic per-task
# "/bin/sh: yarn: command not found", so fail fast with an actionable message instead.
if ! command -v yarn >/dev/null 2>&1; then
    echo "" >&2
    echo "ERROR: 'yarn' is not on PATH, but it is required: 'lerna run' (Nx) spawns" >&2
    echo "       every task as bare 'yarn run <target>'." >&2
    echo "" >&2
    echo "       Fix: corepack enable" >&2
    echo "       (installs a yarn shim next to your current 'node'; with nvm, re-run" >&2
    echo "       after switching Node versions — each version has its own bin dir)" >&2
    echo "" >&2
    exit 1
fi
