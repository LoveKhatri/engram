import fs from 'fs'
import path from 'path'
import { loadConfig } from '../config'
import { openDb } from '../db'
import { createProvider } from '../providers/types'
import { paths } from '../utils/paths'
import { logger, setDebug } from '../utils/logger'
import { startTcpServer } from './server'
import { startScreenshotWatcher } from './watcher'

async function main(): Promise<void> {
  const config = loadConfig()
  if (config.debug) setDebug(true)

  const db = openDb()
  const provider = createProvider(config)

  startTcpServer(config.daemon.port, db, provider)

  const watchDir = config.screenshots.watchDir || paths.defaultScreenshotsDir
  await startScreenshotWatcher(watchDir, db, provider)

  fs.mkdirSync(path.dirname(paths.pidFile), { recursive: true })
  fs.writeFileSync(paths.pidFile, String(process.pid), 'utf-8')

  process.on('SIGTERM', () => {
    try { fs.unlinkSync(paths.pidFile) } catch { /* already gone */ }
    process.exit(0)
  })

  logger.info('Engram daemon started')
}

main().catch((err) => {
  logger.error('Daemon failed to start', err instanceof Error ? err : new Error(String(err)))
  process.exit(1)
})
