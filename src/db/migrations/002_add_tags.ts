import type Database from 'better-sqlite3'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE
    );

    CREATE TABLE IF NOT EXISTS event_tags (
      event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (event_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_event_tags_event ON event_tags(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_tags_tag ON event_tags(tag_id);
  `)
}
