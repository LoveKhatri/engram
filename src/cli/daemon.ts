import fs from 'fs'
import os from 'os'
import path from 'path'
import readline from 'readline'
import { spawn, execSync } from 'child_process'
import cliProgress from 'cli-progress'
import type { Command } from 'commander'
import { loadConfig, saveConfig } from '../config'
import type { EngramConfig } from '../config'
import { paths } from '../utils/paths'
import { openDb } from '../db'
import {
  countEvents,
  getAllEvents,
  deleteAllEmbeddings,
  insertEmbedding,
} from '../db/queries'
import { createProvider } from '../providers/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkDependency(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function isDaemonRunning(): boolean {
  if (!fs.existsSync(paths.pidFile)) return false

  const pid = parseInt(fs.readFileSync(paths.pidFile, 'utf-8').trim(), 10)
  if (isNaN(pid)) {
    fs.unlinkSync(paths.pidFile)
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    fs.unlinkSync(paths.pidFile)
    return false
  }
}

function tidyPath(p: string): string {
  const home = os.homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

function formatBytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const HOOK_START = '# engram:hook:start'
const HOOK_END = '# engram:hook:end'

function installHook(rcFile: string, content: string): 'installed' | 'updated' {
  let existing = ''
  try {
    existing = fs.readFileSync(rcFile, 'utf-8')
  } catch {
    // rc file doesn't exist yet — will be created on write
  }

  const startIdx = existing.indexOf(HOOK_START)
  const endIdx = existing.indexOf(HOOK_END)
  const block = `${HOOK_START}\n${content}${HOOK_END}\n`

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx)
    const after = existing.slice(endIdx + HOOK_END.length)
    // Trim any trailing blank line before the block and leading blank line after
    fs.writeFileSync(rcFile, before.trimEnd() + '\n\n' + block + after.trimStart(), 'utf-8')
    return 'updated'
  }

  // No markers found — append fresh
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  fs.appendFileSync(rcFile, `${prefix}\n${block}`, 'utf-8')
  return 'installed'
}

function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer === 'y' || answer === 'Y')
    })
  })
}

// ---------------------------------------------------------------------------
// Valid config keys for `config set`
// ---------------------------------------------------------------------------

type ConfigLeaf =
  | 'provider.type'
  | 'ollama.host'
  | 'ollama.model'
  | 'gemini.model'
  | 'daemon.port'
  | 'search.maxResults'
  | 'screenshots.watchDir'
  | 'debug'

const VALID_KEYS: ConfigLeaf[] = [
  'provider.type',
  'ollama.host',
  'ollama.model',
  'gemini.model',
  'daemon.port',
  'search.maxResults',
  'screenshots.watchDir',
  'debug',
]

function getNestedValue(obj: EngramConfig, dotKey: string): unknown {
  const parts = dotKey.split('.')
  if (parts.length === 1) {
    return (obj as unknown as Record<string, unknown>)[parts[0]!]
  }
  const [section, field] = parts
  return (obj as unknown as Record<string, Record<string, unknown>>)[section!]?.[field!]
}

function buildPartial(dotKey: string, value: unknown): Partial<EngramConfig> {
  const parts = dotKey.split('.')
  if (parts.length === 1) {
    return { [parts[0]!]: value } as unknown as Partial<EngramConfig>
  }
  const [section, field] = parts
  return { [section!]: { [field!]: value } } as unknown as Partial<EngramConfig>
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function registerDaemonCommands(program: Command): void {
  program
    .command('start')
    .description('Start the Engram daemon')
    .action(() => {
      if (isDaemonRunning()) {
        console.log('Daemon is already running')
        return
      }
      if (!fs.existsSync(paths.configFile)) {
        saveConfig({})
        console.log(`Created default config at ${paths.configFile}`)
      }

      // __dirname = dist/cli/ in prod; daemon is at dist/daemon/index.js
      const daemonPath = path.join(__dirname, '../daemon/index.js')
      fs.mkdirSync(path.dirname(paths.logFile), { recursive: true })
      const logFd = fs.openSync(paths.logFile, 'a')
      const child = spawn('node', [daemonPath], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      })
      child.unref()
      fs.closeSync(logFd)
      console.log('Daemon started')
    })

  program
    .command('stop')
    .description('Stop the Engram daemon')
    .action(() => {
      if (!isDaemonRunning()) {
        console.log('Daemon is not running')
        return
      }
      const pid = parseInt(fs.readFileSync(paths.pidFile, 'utf-8').trim(), 10)
      process.kill(pid, 'SIGTERM')
      console.log('Daemon stopped')
    })

  // -------------------------------------------------------------------------
  // status
  // -------------------------------------------------------------------------

  program
    .command('status')
    .description('Show daemon status and config summary')
    .action(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const version: string = require('../../package.json').version as string
      const config = loadConfig()

      console.log(`Engram v${version}`)
      console.log()

      if (isDaemonRunning()) {
        const pid = parseInt(fs.readFileSync(paths.pidFile, 'utf-8').trim(), 10)
        console.log(`Daemon:     running (PID ${pid})`)
      } else {
        console.log('Daemon:     not running')
      }

      const providerLine =
        config.provider.type === 'ollama'
          ? `ollama (${config.ollama.host} / ${config.ollama.model})`
          : `gemini (${config.gemini.model})`
      console.log(`Provider:   ${providerLine}`)

      if (!fs.existsSync(paths.dbFile)) {
        console.log('Database:   not created yet')
      } else {
        const size = fs.statSync(paths.dbFile).size
        console.log(`Database:   ${tidyPath(paths.dbFile)} (${formatBytes(size)})`)

        try {
          const db = openDb()
          const counts = countEvents(db)
          console.log(`Events:     ${(counts.commands ?? 0).toLocaleString()} commands · ${(counts.screenshots ?? 0).toLocaleString()} screenshots`)

          const embeddingCount = (
            db.prepare('SELECT count(*) AS n FROM embeddings').get() as { n: number }
          ).n
          const pending = (
            db.prepare(
              'SELECT count(*) AS n FROM events e LEFT JOIN embeddings em ON em.event_id = e.id WHERE em.event_id IS NULL'
            ).get() as { n: number }
          ).n
          console.log(`Embeddings: ${embeddingCount.toLocaleString()} indexed · ${pending.toLocaleString()} pending`)
        } catch {
          console.log('Events:     (could not open database)')
        }
      }

      const watchDir = config.screenshots.watchDir || paths.defaultScreenshotsDir
      console.log(`Watching:   ${tidyPath(watchDir)}`)
      console.log(`Config:     ${tidyPath(paths.configFile)}`)
    })

  // -------------------------------------------------------------------------
  // init
  // -------------------------------------------------------------------------

  program
    .command('init')
    .description('Set up shell hook')
    .action(() => {
      const missing: { name: string; pkg: string }[] = []
      if (!checkDependency('ncat'))    missing.push({ name: 'ncat',    pkg: 'nmap-ncat' })
      if (!checkDependency('python3')) missing.push({ name: 'python3', pkg: 'python3' })
      if (missing.length > 0) {
        for (const dep of missing) {
          console.error(`Missing dependency: ${dep.name}`)
          console.error(`Install it with: sudo dnf install ${dep.pkg}`)
        }
        process.exit(1)
      }

      const shell = process.env['SHELL'] ?? ''
      const shellName = path.basename(shell)

      let rcFile: string
      let snippet: (port: number) => string

      if (shellName === 'bash') {
        rcFile = path.join(os.homedir(), '.bashrc')
        snippet = (port) =>
          `export ENGRAM_SESSION_ID=$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 8)\n\n` +
          // DEBUG trap fires before each command; store it so PROMPT_COMMAND can read it
          `__engram_debug_trap() {\n` +
          `  [[ "\${BASH_COMMAND}" == __engram_hook ]] && return\n` +
          `  __ENGRAM_LAST_CMD="\${BASH_COMMAND}"\n` +
          `}\n` +
          `trap '__engram_debug_trap' DEBUG\n\n` +
          `__engram_hook() {\n` +
          `  local exit_code=$?\n` +
          `  local cmd="\${__ENGRAM_LAST_CMD}"\n` +
          `  __ENGRAM_LAST_CMD=''\n` +
          `  [[ -z "$cmd" ]] && return\n` +
          `  local json="{\\\"type\\\":\\\"command\\\",\\\"content\\\":$(printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\\\"source\\\":\\\"$PWD\\\",\\\"exitCode\\\":$exit_code,\\\"sessionId\\\":\\\"$ENGRAM_SESSION_ID\\\",\\\"createdAt\\\":$(date +%s)}"\n` +
          `  (echo "$json" | ncat --send-only 127.0.0.1 ${port} 2>/dev/null) &\n` +
          `}\n\n` +
          `PROMPT_COMMAND="__engram_hook\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"\n`
      } else if (shellName === 'zsh') {
        rcFile = path.join(os.homedir(), '.zshrc')
        snippet = (port) =>
          `export ENGRAM_SESSION_ID=$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 8 2>/dev/null)\n\n` +
          // preexec fires right before each command executes and receives the command as $1
          `__engram_preexec() {\n` +
          `  __ENGRAM_LAST_CMD="$1"\n` +
          `}\n` +
          `preexec_functions+=(__engram_preexec)\n\n` +
          `__engram_hook() {\n` +
          `  local exit_code=$?\n` +
          `  local cmd="$__ENGRAM_LAST_CMD"\n` +
          `  __ENGRAM_LAST_CMD=''\n` +
          `  [[ -z "$cmd" ]] && return\n` +
          `  local json="{\\\"type\\\":\\\"command\\\",\\\"content\\\":$(printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\\\"source\\\":\\\"$PWD\\\",\\\"exitCode\\\":$exit_code,\\\"sessionId\\\":\\\"$ENGRAM_SESSION_ID\\\",\\\"createdAt\\\":$(date +%s)}"\n` +
          `  (echo "$json" | ncat --send-only 127.0.0.1 ${port} 2>/dev/null) &!\n` +
          `}\n\n` +
          `precmd_functions+=(__engram_hook)\n`
      } else {
        console.error(`Unrecognised shell: ${shell || '(SHELL not set)'}`)
        console.error('Manually add the hook from https://github.com/LoveKhatri/engram#manual-hook-setup')
        process.exit(1)
      }

      const port = loadConfig().daemon.port
      let result: 'installed' | 'updated'
      try {
        result = installHook(rcFile, snippet(port))
      } catch (err) {
        console.error(`Failed to write to ${rcFile}: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }

      console.log(`Shell hook ${result} in ${rcFile}`)
      console.log(`Restart your shell or run: source ${rcFile}`)
    })

  // -------------------------------------------------------------------------
  // reindex
  // -------------------------------------------------------------------------

  program
    .command('reindex')
    .description('Re-embed all events (use after switching providers)')
    .action(async () => {
      const confirmed = await promptConfirm(
        'This will delete and rebuild all embeddings. Continue? (y/N) '
      )
      if (!confirmed) {
        console.log('Aborted.')
        return
      }

      let db
      try {
        db = openDb()
      } catch {
        console.error('Database not found. Run: engram start')
        process.exit(1)
      }

      const config = loadConfig()
      const provider = createProvider(config)

      deleteAllEmbeddings(db)
      const events = getAllEvents(db)

      const bar = new cliProgress.SingleBar(
        { format: '  Reindexing [{bar}] {value}/{total} events' },
        cliProgress.Presets.shades_classic
      )
      bar.start(events.length, 0)

      let failed = 0
      for (const event of events) {
        try {
          const embedding = await provider.embed(event.content)
          insertEmbedding(db, event.id, embedding)
        } catch {
          failed++
        }
        bar.increment()
      }

      bar.stop()
      console.log(`Reindexed ${events.length - failed} events (${failed} failed)`)
    })

  // -------------------------------------------------------------------------
  // config
  // -------------------------------------------------------------------------

  const configCmd = program.command('config').description('Manage configuration')

  configCmd
    .command('show')
    .description('Print current config')
    .action(() => {
      const config = loadConfig()
      console.log(`Config file: ${tidyPath(paths.configFile)}`)
      console.log()

      const apiKeyDisplay = config.gemini.apiKey ? '****' : '(not set)'

      const toml = [
        `[provider]`,
        `type = "${config.provider.type}"`,
        ``,
        `[ollama]`,
        `host = "${config.ollama.host}"`,
        `model = "${config.ollama.model}"`,
        ``,
        `[gemini]`,
        `model = "${config.gemini.model}"`,
        `api_key = ${apiKeyDisplay}`,
        ``,
        `[screenshots]`,
        `watch_dir = "${config.screenshots.watchDir}"`,
        ``,
        `[daemon]`,
        `port = ${config.daemon.port}`,
        ``,
        `[search]`,
        `max_results = ${config.search.maxResults}`,
        ``,
        `debug = ${config.debug}`,
        ``,
      ].join('\n')

      console.log(toml)
    })

  configCmd
    .command('set <key> <value>')
    .description('Update a config value')
    .action((key: string, rawValue: string) => {
      if (!(VALID_KEYS as string[]).includes(key)) {
        console.error(`Unknown config key: ${key}`)
        console.error(`Valid keys: ${VALID_KEYS.join(', ')}`)
        process.exit(1)
      }

      const config = loadConfig()
      const current = getNestedValue(config, key)

      let coerced: unknown
      if (typeof current === 'number') {
        const n = Number(rawValue)
        if (isNaN(n)) {
          console.error(`Expected a number for ${key}, got: ${rawValue}`)
          process.exit(1)
        }
        coerced = n
      } else if (typeof current === 'boolean') {
        coerced = rawValue === 'true'
      } else {
        coerced = rawValue
      }

      saveConfig(buildPartial(key, coerced))
      console.log(`Updated ${key} = ${String(coerced)}`)
    })
}
