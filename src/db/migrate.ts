import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import { logger } from '../utils/logger'

// In dev (tsx): __dirname = src/db/ → resolves to src/db/migrations/
// In prod (bundled into dist/cli/ or dist/daemon/): → resolves to dist/db/migrations/
const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations')

interface MigrationModule {
  up: (db: Database.Database) => void
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `)

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => (f.endsWith('.js') || (f.endsWith('.ts') && !f.endsWith('.d.ts'))))
    .sort()

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[])
      .map(r => r.name)
  )

  const insert = db.prepare(
    'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)'
  )

  for (const file of files) {
    const name = file.replace(/\.(ts|js)$/, '')
    if (applied.has(name)) continue

    logger.info(`Running migration: ${name}`)

    // require() path without extension — Node/tsx resolution handles .js/.ts
    const mod = require(path.join(MIGRATIONS_DIR, name)) as MigrationModule

    const runInTx = db.transaction(() => {
      mod.up(db)
      insert.run(name, Math.floor(Date.now() / 1000))
    })

    try {
      runInTx()
    } catch (err) {
      logger.error(`Migration failed: ${name}`, err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }
}
