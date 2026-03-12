import { execSync } from 'child_process'
import type { Command } from 'commander'
import { loadConfig } from '../config'
import { openDb } from '../db'
import { startWebServer } from '../web/server'

export function registerWebCommand(program: Command): void {
  program
    .command('web')
    .description('Start the web dashboard')
    .option('--port <n>', 'Port to listen on', '7843')
    .action((opts: { port: string }) => {
      const port = parseInt(opts.port, 10)

      let db
      try {
        db = openDb()
      } catch {
        console.error('Database not found. Run: engram start')
        process.exit(1)
      }

      const config = loadConfig()
      startWebServer(port, db, config)

      const url = `http://localhost:${port}`
      console.log(`Dashboard running at ${url}`)

      // Try to open browser
      try {
        if (process.platform === 'darwin') {
          execSync(`open ${url}`, { stdio: 'ignore' })
        } else {
          execSync(`xdg-open ${url}`, { stdio: 'ignore' })
        }
      } catch {
        // Browser open failed — URL already printed above
      }
    })
}
