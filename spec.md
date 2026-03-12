# Engram — Internal Build Specification

> This document is the single source of truth for building Engram. Follow it in order. Update it as decisions change.

---

## Table of Contents

1. [What We're Building](#1-what-were-building)
2. [Tech Stack](#2-tech-stack)
3. [Repository Structure](#3-repository-structure)
4. [Config System](#4-config-system)
5. [Database Schema](#5-database-schema)
6. [Daemon](#6-daemon)
7. [Shell Hook](#7-shell-hook)
8. [Screenshot Vault](#8-screenshot-vault)
9. [Embedding Providers](#9-embedding-providers)
10. [Vector Search](#10-vector-search)
11. [CLI Commands](#11-cli-commands)
12. [Todo Module](#12-todo-module)
13. [Error Handling Strategy](#13-error-handling-strategy)
14. [Build Order](#14-build-order)
15. [Open Questions](#15-open-questions)

---

## 1. What We're Building

**Engram** is a passive CLI daemon for developers. It runs silently in the background and:

- Captures every terminal command you run (via a shell hook)
- Watches your screenshots folder and OCR's new screenshots
- Embeds all of this text using an external embedding model
- Stores everything locally in SQLite
- Lets you retrieve anything later with plain English: `engram search "that docker networking thing"`

Plus a simple todo module: `engram todo add "fix auth bug"`.

**Nothing runs on your machine except the daemon itself.** The embedding model lives on a remote Ollama instance or is called via the Gemini API. Your machine stays free.

---

## 2. Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript (Node.js 20+) | Both of us know it, no ML libs needed locally |
| CLI framework | Commander.js | Straightforward, well-documented |
| Terminal output | Chalk + cli-table3 | Colours and tables without overhead |
| IPC | TCP localhost (port 7842) | Works on Linux, macOS, Windows — no Unix socket issues |
| Filesystem watching | chokidar | Cross-platform, battle-tested |
| OCR | tesseract.js | Pure JS, no binary install required |
| Embeddings | Ollama API or Gemini API | User's choice, configured via env/config |
| Database | better-sqlite3 + sqlite-vec | Synchronous, fast, single file |
| Config | TOML (toml npm package) | Human-readable, widely understood |
| Packaging | npm global install | `npm install -g engram` |

**Node version:** 20+ (required for native fetch)

---

## 3. Repository Structure

```
engram/
├── src/
│   ├── cli/
│   │   ├── index.ts           # Entry point, registers all commands
│   │   ├── search.ts          # `engram search` command
│   │   ├── todo.ts            # `engram todo` subcommands
│   │   └── daemon.ts          # `engram start`, `engram stop`, `engram status`
│   ├── daemon/
│   │   ├── index.ts           # Daemon process entry point
│   │   ├── server.ts          # TCP socket server, receives events from hook
│   │   └── watcher.ts         # Screenshot folder watcher (chokidar)
│   ├── providers/
│   │   ├── types.ts           # EmbeddingProvider interface
│   │   ├── ollama.ts          # Ollama provider
│   │   └── gemini.ts          # Gemini provider
│   ├── db/
│   │   ├── index.ts           # DB connection, loads sqlite-vec extension
│   │   ├── schema.ts          # Table creation / migrations
│   │   └── queries.ts         # All SQL queries as typed functions
│   ├── ocr/
│   │   └── index.ts           # Tesseract.js wrapper
│   ├── config/
│   │   └── index.ts           # Load/save/validate config + env var overrides
│   └── utils/
│       ├── paths.ts           # OS-aware paths (config dir, db dir, screenshots dir)
│       └── logger.ts          # Simple stdout logger (debug/info/error)
├── hooks/
│   ├── bash.sh                # Bash PROMPT_COMMAND hook
│   ├── zsh.sh                 # Zsh precmd hook
│   └── powershell.ps1         # PowerShell PSReadLine hook
├── scripts/
│   └── postinstall.ts         # Runs after npm install — prints setup instructions
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. Config System

### Location

| OS | Path |
|---|---|
| Linux | `~/.config/engram/config.toml` |
| macOS | `~/.config/engram/config.toml` |
| Windows | `%APPDATA%\engram\config.toml` |

### Schema

```toml
[provider]
# "ollama" or "gemini"
type = "ollama"

[ollama]
host = "http://localhost:11434"
model = "nomic-embed-text"

[gemini]
# api_key is better set via GEMINI_API_KEY env var, not stored here
model = "text-embedding-004"

[screenshots]
# leave blank to use OS default
watch_dir = ""

[daemon]
port = 7842

[search]
max_results = 10
```

### Environment Variable Overrides

Every config value has an env var override. Env vars always win over config file.

| Env Var | Overrides |
|---|---|
| `ENGRAM_PROVIDER` | `provider.type` |
| `ENGRAM_OLLAMA_HOST` | `ollama.host` |
| `ENGRAM_OLLAMA_MODEL` | `ollama.model` |
| `GEMINI_API_KEY` | Gemini auth (never put in config file) |
| `ENGRAM_DAEMON_PORT` | `daemon.port` |
| `ENGRAM_SCREENSHOTS_DIR` | `screenshots.watch_dir` |

### Config module (`src/config/index.ts`)

```typescript
export interface EngramConfig {
  provider: { type: 'ollama' | 'gemini' }
  ollama: { host: string; model: string }
  gemini: { model: string; apiKey?: string }
  screenshots: { watchDir: string }
  daemon: { port: number }
  search: { maxResults: number }
}

export function loadConfig(): EngramConfig
export function saveConfig(partial: Partial<EngramConfig>): void
export function configPath(): string
```

The `loadConfig()` function:
1. Reads TOML from config path (if exists)
2. Merges defaults for any missing keys
3. Applies env var overrides
4. Returns the final merged config

---

## 5. Database Schema

### Location

| OS | Path |
|---|---|
| Linux | `~/.local/share/engram/engram.db` |
| macOS | `~/Library/Application Support/engram/engram.db` |
| Windows | `%APPDATA%\engram\engram.db` |

### Tables

```sql
-- All captured events (commands + screenshots)
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK(type IN ('command', 'screenshot')),
  content     TEXT NOT NULL,        -- command string or OCR text
  source      TEXT,                 -- working directory (commands) or file path (screenshots)
  exit_code   INTEGER,              -- null for screenshots
  session_id  TEXT,                 -- groups events in the same terminal session
  created_at  INTEGER NOT NULL      -- unix timestamp (seconds)
);

-- Vector embeddings linked to events
CREATE TABLE IF NOT EXISTS embeddings (
  event_id    INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  embedding   F32_BLOB(384)         -- 384 dims for MiniLM / nomic-embed-text
);

-- Todo items
CREATE TABLE IF NOT EXISTS todos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,  -- 0 = open, 1 = done
  created_at  INTEGER NOT NULL,
  done_at     INTEGER                      -- null until completed
);
```

> **Note on embedding dimensions:** nomic-embed-text produces 768-dim vectors. all-MiniLM-L6-v2 produces 384-dim. Gemini text-embedding-004 produces 768-dim. We should make the dimension configurable — set it in config and use it in the schema creation. Default to 768 to support both Ollama default and Gemini. If someone switches models, they need to rebuild the index (we add an `engram reindex` command for this).

**Revised embedding column:**
```sql
embedding   F32_BLOB(768)   -- configurable, default 768
```

### Indices

```sql
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done);
```

### sqlite-vec setup

```typescript
// src/db/index.ts
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'

export function openDb(): Database.Database {
  const db = new Database(dbPath())
  sqliteVec.load(db)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}
```

---

## 6. Daemon

The daemon is a long-running Node.js process. It does two things:
1. Listens on a TCP socket for shell hook events
2. Watches the screenshots directory for new files

### Starting the daemon

```bash
engram start          # starts daemon in background
engram stop           # kills the daemon
engram status         # is it running?
```

The daemon writes its PID to `~/.local/share/engram/daemon.pid`. `engram stop` reads this and sends SIGTERM. `engram status` checks if the PID is alive.

On Windows, use a `.pid` file in `%APPDATA%\engram\`.

### Daemon process (`src/daemon/index.ts`)

```typescript
async function main() {
  const config = loadConfig()
  const db = openDb()
  runMigrations(db)

  const provider = createProvider(config)

  // Start TCP server for shell hook events
  startTcpServer(config.daemon.port, db, provider)

  // Start screenshot watcher
  startScreenshotWatcher(config.screenshots.watchDir, db, provider)

  // Write PID file
  writePidFile()

  process.on('SIGTERM', () => {
    deletePidFile()
    process.exit(0)
  })
}
```

### TCP Server (`src/daemon/server.ts`)

The shell hook sends a newline-delimited JSON payload:

```json
{"type":"command","content":"git push origin main","source":"/home/user/projects/engram","exitCode":0,"sessionId":"abc123","createdAt":1710000000}
```

The server:
1. Receives the JSON
2. Inserts the event into `events` table
3. Gets embedding from provider
4. Inserts into `embeddings` table

Embedding is fire-and-forget from the hook's perspective — if the provider is down, we log the error and store the event without an embedding. Those events can be re-embedded later via `engram reindex`.

```typescript
// src/daemon/server.ts
export function startTcpServer(port: number, db: Database, provider: EmbeddingProvider) {
  const server = net.createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) handleEvent(JSON.parse(line), db, provider)
      }
    })
  })
  server.listen(port, '127.0.0.1')
}
```

---

## 7. Shell Hook

Installed by `engram init`. Appends a few lines to the user's shell config file. The hook must be:
- Fast (under 10ms overhead per command)
- Non-blocking (never delays the shell prompt)
- Silent (no output unless there's a catastrophic error)

### Session ID

Generated once per shell session and stored in `ENGRAM_SESSION_ID`. Used to group related commands together.

### Bash (`hooks/bash.sh`)

```bash
# Engram shell hook — added by `engram init`
export ENGRAM_SESSION_ID=$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 8)

__engram_hook() {
  local exit_code=$?
  local cmd
  cmd=$(HISTTIMEFORMAT= history 1 | sed 's/^[ ]*[0-9]*[ ]*//')
  # Send to daemon non-blocking
  echo "{\"type\":\"command\",\"content\":$(printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"source\":\"$PWD\",\"exitCode\":$exit_code,\"sessionId\":\"$ENGRAM_SESSION_ID\",\"createdAt\":$(date +%s)}" \
    | nc -q 0 127.0.0.1 7842 2>/dev/null &
}

PROMPT_COMMAND="__engram_hook${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
```

### Zsh (`hooks/zsh.sh`)

```zsh
# Engram shell hook — added by `engram init`
export ENGRAM_SESSION_ID=$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 8 2>/dev/null)

__engram_hook() {
  local exit_code=$?
  local cmd=$history[$HISTCMD]
  echo "{\"type\":\"command\",\"content\":$(printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"source\":\"$PWD\",\"exitCode\":$exit_code,\"sessionId\":\"$ENGRAM_SESSION_ID\",\"createdAt\":$(date +%s)}" \
    | nc -q 0 127.0.0.1 7842 2>/dev/null &
}

precmd_functions+=(__engram_hook)
```

### PowerShell (`hooks/powershell.ps1`)

```powershell
# Engram shell hook — added by `engram init`
$env:ENGRAM_SESSION_ID = -join ((97..122) | Get-Random -Count 8 | % {[char]$_})

Set-PSReadLineOption -AddToHistoryHandler {
  param($command)
  $payload = @{
    type      = "command"
    content   = $command
    source    = (Get-Location).Path
    exitCode  = $LASTEXITCODE
    sessionId = $env:ENGRAM_SESSION_ID
    createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  } | ConvertTo-Json -Compress
  Start-Job -ScriptBlock {
    param($p, $port)
    $tcp = New-Object System.Net.Sockets.TcpClient('127.0.0.1', $port)
    $stream = $tcp.GetStream()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($p + "`n")
    $stream.Write($bytes, 0, $bytes.Length)
    $tcp.Close()
  } -ArgumentList $payload, 7842 | Out-Null
  return $true
}
```

### `engram init` logic

```
1. Detect current shell (check $SHELL on Unix, check for pwsh/powershell on Windows)
2. Ask user to confirm which shell config file to modify
3. Check if hook is already present (grep for "Engram shell hook")
4. If not present, append the hook snippet
5. Print: "Restart your shell or run: source ~/.zshrc"
```

---

## 8. Screenshot Vault

### Default watch directories

| OS | Default path |
|---|---|
| Linux | `~/Pictures/Screenshots` — falls back to `~/Pictures` if not found |
| macOS | `~/Desktop` |
| Windows | `C:\Users\<User>\Pictures\Screenshots` |

Override with `ENGRAM_SCREENSHOTS_DIR` or `screenshots.watch_dir` in config.

### Watcher (`src/daemon/watcher.ts`)

```typescript
import chokidar from 'chokidar'
import { createWorker } from 'tesseract.js'

export async function startScreenshotWatcher(dir: string, db: Database, provider: EmbeddingProvider) {
  const worker = await createWorker('eng')

  chokidar.watch(dir, {
    ignoreInitial: true,          // don't process existing screenshots on startup
    awaitWriteFinish: {
      stabilityThreshold: 1000,   // wait 1s after file stops changing before processing
      pollInterval: 200
    }
  }).on('add', async (filePath) => {
    if (!isImage(filePath)) return
    await processScreenshot(filePath, worker, db, provider)
  })
}

function isImage(path: string): boolean {
  return /\.(png|jpg|jpeg|webp)$/i.test(path)
}

async function processScreenshot(filePath, worker, db, provider) {
  try {
    const { data: { text } } = await worker.recognize(filePath)
    if (!text.trim()) return  // blank screenshot, skip

    const event = insertEvent(db, {
      type: 'screenshot',
      content: text.trim(),
      source: filePath,
      createdAt: Math.floor(Date.now() / 1000)
    })

    const embedding = await provider.embed(text.trim())
    insertEmbedding(db, event.id, embedding)
  } catch (err) {
    logger.error('Screenshot processing failed:', filePath, err)
  }
}
```

---

## 9. Embedding Providers

### Interface (`src/providers/types.ts`)

```typescript
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>
  name: string
}

export function createProvider(config: EngramConfig): EmbeddingProvider {
  switch (config.provider.type) {
    case 'ollama': return new OllamaProvider(config.ollama)
    case 'gemini': return new GeminiProvider(config.gemini)
    default: throw new Error(`Unknown provider: ${config.provider.type}`)
  }
}
```

### Ollama Provider (`src/providers/ollama.ts`)

```typescript
export class OllamaProvider implements EmbeddingProvider {
  name = 'ollama'

  constructor(private config: { host: string; model: string }) {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.config.host}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, prompt: text })
    })
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
    const data = await res.json() as { embedding: number[] }
    return data.embedding
  }
}
```

### Gemini Provider (`src/providers/gemini.ts`)

```typescript
export class GeminiProvider implements EmbeddingProvider {
  name = 'gemini'
  private apiKey: string

  constructor(private config: { model: string; apiKey?: string }) {
    this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? ''
    if (!this.apiKey) throw new Error('GEMINI_API_KEY is not set')
  }

  async embed(text: string): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:embedContent?key=${this.apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.config.model}`,
        content: { parts: [{ text }] }
      })
    })
    if (!res.ok) throw new Error(`Gemini error: ${res.status}`)
    const data = await res.json() as { embedding: { values: number[] } }
    return data.embedding.values
  }
}
```

---

## 10. Vector Search

### Query flow

```
user runs: engram search "docker networking issue"
  → embed query text using configured provider
  → run cosine similarity against embeddings table using sqlite-vec
  → join with events table for full context
  → rank by score, return top N
  → display in terminal
```

### SQL query (`src/db/queries.ts`)

```typescript
export function searchEvents(db: Database, queryEmbedding: number[], limit: number) {
  const embedding = new Float32Array(queryEmbedding)

  return db.prepare(`
    SELECT
      e.id,
      e.type,
      e.content,
      e.source,
      e.exit_code,
      e.created_at,
      vec_distance_cosine(em.embedding, ?) AS distance
    FROM embeddings em
    JOIN events e ON e.id = em.event_id
    ORDER BY distance ASC
    LIMIT ?
  `).all(embedding, limit)
}
```

> sqlite-vec uses `vec_distance_cosine` — lower is more similar (0 = identical). We sort ASC.

### Display format

```
engram search "docker networking"

  #1  [command]  2 days ago
      docker network create --driver bridge mynet
      📁 ~/projects/api

  #2  [screenshot]  3 days ago
      "Error response from daemon: network mynet not found..."
      🖼  ~/Pictures/Screenshots/2026-03-10.png

  #3  [command]  1 week ago
      docker inspect mynet | grep -i subnet
      📁 ~/projects/api
```

---

## 11. CLI Commands

All commands live in `src/cli/index.ts` and are registered with Commander.js.

### Full command list

```
engram init                         Set up shell hook
engram start                        Start the daemon
engram stop                         Stop the daemon
engram status                       Show daemon status + config summary
engram search <query>               Search with natural language
engram reindex                      Re-embed all events (use if you switch providers)
engram todo add <text>              Add a todo
engram todo list                    List open todos
engram todo done <id>               Mark todo as done
engram todo delete <id>             Delete a todo
engram config show                  Print current config
engram config set <key> <value>     Update a config value
```

### `engram status` output

```
Engram v0.1.0

  Daemon:     running (PID 12345)
  Provider:   ollama (http://192.168.1.50:11434 / nomic-embed-text)
  Database:   ~/.local/share/engram/engram.db (42 MB)
  Events:     8,432 commands · 214 screenshots
  Watching:   ~/Pictures/Screenshots
```

### `engram reindex`

Needed when the user switches embedding providers (different model = different vector space, old embeddings are incompatible).

```
1. Ask for confirmation ("This will delete and rebuild all embeddings. Continue? y/N")
2. DELETE all rows from embeddings table
3. Fetch all events from events table
4. Re-embed each one (with progress bar)
5. Insert new embeddings
```

Use a progress bar (cli-progress package) since this can take a while.

---

## 12. Todo Module

Intentionally simple. No embedding, no search. Just a clean terminal interface.

### Commands

```bash
engram todo add "fix the auth middleware bug"
# → Added todo #7: fix the auth middleware bug

engram todo list
# →
#   #  Text                            Added
#   ─────────────────────────────────────────
#   5  review PR #42                   2 days ago
#   6  update README                   1 day ago
#   7  fix the auth middleware bug      just now

engram todo done 7
# → ✓ Marked #7 as done

engram todo delete 5
# → Deleted #5
```

`engram todo list` shows only open todos by default. Add `--all` flag to show completed ones too.

---

## 13. Error Handling Strategy

**Shell hook errors:** Must be completely silent. If the daemon is not running, the hook should fail silently. Never block the shell prompt. Use `2>/dev/null` and background processes everywhere.

**Daemon errors:** Log to `~/.local/share/engram/daemon.log`. Errors in the screenshot watcher or embedding pipeline should not crash the daemon — catch, log, continue.

**CLI errors:** Show a clean error message to the user and exit with code 1. No stack traces in production output. Stack traces only if `ENGRAM_DEBUG=true` is set.

**Provider errors:** If the embedding provider is unreachable during capture, store the event without an embedding and log a warning. Events without embeddings are excluded from search results but can be recovered via `engram reindex` when the provider is back up.

**Database errors:** These are fatal — if we can't open the DB, the daemon should exit with a clear message.

---

## 14. Build Order

Build in this exact order. Each phase produces something testable before moving to the next.

```
Phase 1 — Foundation
  ✦ Set up repo, tsconfig, package.json
  ✦ Implement src/utils/paths.ts (OS-aware paths)
  ✦ Implement src/config/index.ts (load/save/env overrides)
  ✦ Implement src/db/index.ts + schema.ts (open DB, create tables, load sqlite-vec)
  ✦ Write a quick test script: open DB, insert a fake event, read it back
  → Checkpoint: DB is working

Phase 2 — Daemon + Shell Hook
  ✦ Implement src/daemon/server.ts (TCP socket, receive JSON events)
  ✦ Implement src/daemon/index.ts (start server, write PID file)
  ✦ Implement engram start / stop / status CLI commands
  ✦ Write and test bash hook manually (pipe a test payload to port 7842)
  ✦ Write zsh hook
  ✦ Write PowerShell hook
  ✦ Implement engram init (detect shell, append hook)
  → Checkpoint: `engram start`, open terminal, run a command, see it in DB

Phase 3 — Screenshot Vault
  ✦ Implement src/ocr/index.ts (tesseract.js wrapper)
  ✦ Implement src/daemon/watcher.ts (chokidar + OCR + store)
  ✦ Wire watcher into daemon startup
  ✦ Test: take a screenshot, verify it appears in events table
  → Checkpoint: screenshots are being indexed

Phase 4 — Embedding Providers
  ✦ Implement src/providers/types.ts (interface + factory)
  ✦ Implement OllamaProvider
  ✦ Implement GeminiProvider
  ✦ Wire provider into daemon event handler (embed on insert)
  ✦ Test: insert an event, verify embedding row is created with correct dimensions
  → Checkpoint: embeddings are being stored

Phase 5 — Search
  ✦ Implement searchEvents() query in src/db/queries.ts
  ✦ Implement engram search <query> CLI command
  ✦ Implement display formatting (Chalk, result cards)
  ✦ Test: run several commands, search for one, verify it surfaces
  → Checkpoint: search is working end-to-end

Phase 6 — Todo Module
  ✦ Implement all todo queries in src/db/queries.ts
  ✦ Implement engram todo subcommands
  ✦ Test all four operations
  → Checkpoint: todo module working

Phase 7 — Polish
  ✦ engram reindex command
  ✦ engram config show / set
  ✦ engram status with full stats
  ✦ Error handling audit (silent hook failures, daemon log, provider down handling)
  ✦ README: install, init, usage, config reference
  ✦ npm publish prep (bin field in package.json, postinstall script)
```

---

## 15. Open Questions

Things we haven't fully decided yet. Resolve these before or during the relevant build phase.

| # | Question | Current thinking |
|---|---|---|
| 1 | Embedding dimensions — 384 or 768? | Default 768 (covers Gemini + nomic-embed-text). Make it configurable in config. If you use MiniLM (384-dim) you set it in config. |
| 2 | Should we embed failed commands (exit_code != 0)? | Yes — error commands are often the most useful to retrieve later. |
| 3 | What happens if the daemon isn't running when `engram search` is called? | Search reads the DB directly — no daemon needed for search. Daemon is only needed for capture. |
| 4 | How do we handle very long OCR text (huge screenshot)? | Truncate to first 2000 characters before embedding. Store full text in events.content. |
| 5 | Do we filter out sensitive commands (passwords in args)? | Add a basic blocklist: commands containing `password`, `secret`, `token`, `key` as argument flags get content replaced with `[redacted]`. Make this configurable. |
| 6 | Session ID strategy on Windows (no /dev/urandom)? | Use `crypto.randomBytes(4).toString('hex')` in the daemon, pass it to the PS hook on startup. Or generate in PS using `[System.Guid]::NewGuid().ToString().Substring(0,8)`. |
| 7 | npm package name — is `engram` taken? | Check before publishing. Fallback: `engram-cli`. |