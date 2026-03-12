import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import type { Command } from 'commander'
import { loadConfig } from '../config'
import { paths } from '../utils/paths'

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
      // __dirname = dist/cli/ in prod; daemon is at dist/daemon/index.js
      const daemonPath = path.join(__dirname, '../daemon/index.js')
      const child = spawn('node', [daemonPath], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
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
      console.log('TODO: shell hook setup — coming soon')
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
