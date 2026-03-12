import type Database from 'better-sqlite3'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
      content,
      source,
      content='events',
      content_rowid='id'
    );

    INSERT INTO events_fts(rowid, content, source)
      SELECT id, content, COALESCE(source, '') FROM events;

    CREATE TRIGGER IF NOT EXISTS events_fts_insert AFTER INSERT ON events BEGIN
      INSERT INTO events_fts(rowid, content, source)
        VALUES (new.id, new.content, COALESCE(new.source, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS events_fts_delete AFTER DELETE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, content, source)
        VALUES ('delete', old.id, old.content, COALESCE(old.source, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS events_fts_update AFTER UPDATE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, content, source)
        VALUES ('delete', old.id, old.content, COALESCE(old.source, ''));
      INSERT INTO events_fts(rowid, content, source)
        VALUES (new.id, new.content, COALESCE(new.source, ''));
    END;
  `)
}
