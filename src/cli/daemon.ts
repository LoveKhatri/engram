import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, execSync } from 'child_process'
import type { Command } from 'commander'
import { loadConfig, saveConfig } from '../config'
import { paths } from '../utils/paths'

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

  program
    .command('status')
    .description('Show daemon status and config summary')
    .action(() => {
      const config = loadConfig()
      if (isDaemonRunning()) {
        const pid = parseInt(fs.readFileSync(paths.pidFile, 'utf-8').trim(), 10)
        console.log(`Running (PID ${pid})`)
      } else {
        console.log('Not running')
      }
      console.log(`Provider: ${config.provider.type}`)
      console.log(`Port:     ${config.daemon.port}`)
    })

  program
    .command('init')
    .description('Set up shell hook')
    .action(() => {
      const missing: { name: string; pkg: string }[] = []
      if (!checkDependency('nc'))      missing.push({ name: 'nc',      pkg: 'nmap-ncat' })
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
          `\n# engram shell hook — managed by engram init\n` +
          `export ENGRAM_SESSION_ID=$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 8)\n\n` +
          `__engram_hook() {\n` +
          `  local exit_code=$?\n` +
          `  local cmd\n` +
          `  cmd=$(HISTTIMEFORMAT= history 1 | sed 's/^[ ]*[0-9]*[ ]*//')\n` +
          `  local json="{\\"type\\":\\"command\\",\\"content\\":$(printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\\"source\\":\\"$PWD\\",\\"exitCode\\":$exit_code,\\"sessionId\\":\\"$ENGRAM_SESSION_ID\\",\\"createdAt\\":$(date +%s)}"\n` +
          `  (echo "$json" | nc -q 0 127.0.0.1 ${port} 2>/dev/null) &!\n` +
          `}\n\n` +
          `PROMPT_COMMAND="__engram_hook\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"\n`
      } else if (shellName === 'zsh') {
        rcFile = path.join(os.homedir(), '.zshrc')
        snippet = (port) =>
          `\n# engram shell hook — managed by engram init\n` +
          `export ENGRAM_SESSION_ID=$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 8 2>/dev/null)\n\n` +
          `__engram_hook() {\n` +
          `  local exit_code=$?\n` +
          `  local cmd=$history[$HISTCMD]\n` +
          `  local json="{\\"type\\":\\"command\\",\\"content\\":$(printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\\"source\\":\\"$PWD\\",\\"exitCode\\":$exit_code,\\"sessionId\\":\\"$ENGRAM_SESSION_ID\\",\\"createdAt\\":$(date +%s)}"\n` +
          `  (echo "$json" | nc -q 0 127.0.0.1 ${port} 2>/dev/null) &!\n` +
          `}\n\n` +
          `precmd_functions+=(__engram_hook)\n`
      } else {
        console.error(`Unrecognised shell: ${shell || '(SHELL not set)'}`)
        console.error('Manually add the hook from https://github.com/LoveKhatri/engram#manual-hook-setup')
        process.exit(1)
      }

      let existing: string
      try {
        existing = fs.readFileSync(rcFile, 'utf-8')
      } catch {
        existing = ''
      }

      if (existing.includes('# engram shell hook')) {
        console.log(`Shell hook already installed in ${rcFile}. Nothing to do.`)
        return
      }

      const port = loadConfig().daemon.port
      try {
        fs.appendFileSync(rcFile, snippet(port), 'utf-8')
      } catch (err) {
        console.error(`Failed to write to ${rcFile}: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }

      console.log(`Shell hook installed in ${rcFile}`)
      console.log(`Restart your shell or run: source ${rcFile}`)
    })

  program
    .command('reindex')
    .description('Re-embed all events (use after switching providers)')
    .action(() => {
      console.log('TODO: reindex — coming soon')
    })

  const configCmd = program.command('config').description('Manage configuration')

  configCmd
    .command('show')
    .description('Print current config')
    .action(() => { console.log('TODO: config show') })

  configCmd
    .command('set <key> <value>')
    .description('Update a config value')
    .action(() => { console.log('TODO: config set') })
}
