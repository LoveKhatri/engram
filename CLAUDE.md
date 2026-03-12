# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Engram is a passive CLI daemon for semantic terminal history search. It captures terminal commands via shell hooks and OCR's screenshots, embeds them as vectors, and stores them in a local SQLite database for natural-language retrieval.

## Commands

```bash
# Install dependencies
pnpm install

# Development
pnpm run dev           # Run CLI: tsx src/cli/index.ts
pnpm run dev:daemon    # Run daemon: tsx src/daemon/index.ts

# Build
pnpm run build         # Compile to dist/ via tsup
pnpm run build:watch   # Watch mode

# Type checking (no tests exist yet)
pnpm run typecheck
```

## Architecture

The system is a 3-tier pipeline: **capture → process/store → retrieve**.

```
Shell Hooks (bash/zsh/ps1)
  └─→ TCP port 7842 → Daemon server
Screenshot Watcher (chokidar)
  └─→ OCR (tesseract.js) → Daemon

Daemon → EmbeddingProvider (Ollama or Gemini) → SQLite (sqlite-vec)

CLI → SQLite vector search → ranked results
```

**Key source directories:**
- `src/cli/` — Commander.js commands (`daemon`, `search`, `todo`)
- `src/daemon/` — Long-running process: TCP server + screenshot watcher
- `src/providers/` — `EmbeddingProvider` interface, Ollama and Gemini implementations
- `src/db/` — better-sqlite3 connection, schema, typed query functions
- `src/ocr/` — tesseract.js wrapper
- `src/config/` — TOML config with env-variable overrides
- `src/utils/` — OS-aware paths (`paths.ts`), structured logging (`logger.ts`)
- `hooks/` — Shell hook scripts (bash, zsh, PowerShell) injected by `engram init`

**Build phases** (from `spec.md`, the single source of truth for design decisions):
1. Foundation: paths, config, db/schema ✓
2. Daemon + shell hook: server.ts, daemon.ts, init command
3. Screenshot vault: ocr/, watcher.ts
4. Embedding providers: ollama.ts, gemini.ts
5. Search: vector similarity query
6. Todo module
7. Polish: reindex, config CLI, error handling

## Configuration

- Config file: `~/.config/engram/config.toml` (Linux/macOS), `%APPDATA%\engram\config.toml` (Windows)
- DB + PID + log: `~/.local/share/engram/` (Linux), `~/Library/Application Support/engram/` (macOS)
- Daemon port: 7842 (override via `ENGRAM_DAEMON_PORT`)
- Providers: `ollama` (default, `nomic-embed-text`) or `gemini` (`text-embedding-004`, needs `GEMINI_API_KEY`)
- Debug logging: `ENGRAM_DEBUG=true`
- Embeddings are 768-dimensional F32 vectors (compatible with both providers)

## Implementation Status

Most source files are stubs awaiting implementation. Check `spec.md` for full specs on each component before implementing. Key unimplemented files: `src/daemon/index.ts`, `src/daemon/server.ts`, `src/daemon/watcher.ts`, `src/ocr/index.ts`, `src/providers/ollama.ts`, `src/providers/gemini.ts`, `src/cli/daemon.ts`, `src/cli/search.ts`, `src/cli/todo.ts`.
