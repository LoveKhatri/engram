import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import fs from 'fs'
import path from 'path'
import { paths } from '../utils/paths'
import { runMigrations } from './migrate'

export type DB = Database.Database

let _db: DB | null = null

export function openDb(): DB {
  if (_db) return _db

  fs.mkdirSync(path.dirname(paths.dbFile), { recursive: true })

  const db = new Database(paths.dbFile)

  // Load the sqlite-vec extension for vector similarity search
  sqliteVec.load(db)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  _db = db
  return db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
