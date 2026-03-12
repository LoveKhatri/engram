import type Database from 'better-sqlite3'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL CHECK(type IN ('command', 'screenshot')),
      content    TEXT NOT NULL,
      source     TEXT,
      exit_code  INTEGER,
      session_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      event_id  INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      embedding F32_BLOB(768)
    );

    CREATE TABLE IF NOT EXISTS todos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      text       TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      done_at    INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_events_type       ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_todos_done        ON todos(done);
  `)
}
