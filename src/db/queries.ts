import type { DB } from './index'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventRow {
  id: number
  type: 'command' | 'screenshot'
  content: string
  source: string | null
  exit_code: number | null
  session_id: string | null
  created_at: number
}

export interface TodoRow {
  id: number
  text: string
  done: number
  created_at: number
  done_at: number | null
}

export interface SearchResult extends EventRow {
  distance: number
}

export interface InsertEventInput {
  type: 'command' | 'screenshot'
  content: string
  source?: string
  exitCode?: number
  sessionId?: string
  createdAt: number
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function insertEvent(db: DB, input: InsertEventInput): EventRow {
  const stmt = db.prepare(`
    INSERT INTO events (type, content, source, exit_code, session_id, created_at)
    VALUES (@type, @content, @source, @exitCode, @sessionId, @createdAt)
  `)
  const result = stmt.run({
    type: input.type,
    content: input.content,
    source: input.source ?? null,
    exitCode: input.exitCode ?? null,
    sessionId: input.sessionId ?? null,
    createdAt: input.createdAt,
  })
  return getEvent(db, result.lastInsertRowid as number)!
}

export function getEvent(db: DB, id: number): EventRow | undefined {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined
}

export function getAllEvents(db: DB): EventRow[] {
  return db.prepare('SELECT * FROM events ORDER BY created_at ASC').all() as EventRow[]
}

export function countEvents(db: DB): { commands: number; screenshots: number } {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN type = 'command' THEN 1 ELSE 0 END) AS commands,
      SUM(CASE WHEN type = 'screenshot' THEN 1 ELSE 0 END) AS screenshots
    FROM events
  `).get() as { commands: number; screenshots: number }
  return row
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export function insertEmbedding(db: DB, eventId: number, embedding: number[]): void {
  db.prepare(`
    INSERT OR REPLACE INTO embeddings (event_id, embedding)
    VALUES (?, ?)
  `).run(eventId, new Float32Array(embedding))
}

export function deleteAllEmbeddings(db: DB): void {
  db.prepare('DELETE FROM embeddings').run()
}

// ---------------------------------------------------------------------------
// Vector search — Phase 5
// ---------------------------------------------------------------------------

export function searchEvents(db: DB, queryEmbedding: number[], limit: number): SearchResult[] {
  return db.prepare(`
    SELECT
      e.id,
      e.type,
      e.content,
      e.source,
      e.exit_code,
      e.session_id,
      e.created_at,
      vec_distance_cosine(em.embedding, ?) AS distance
    FROM embeddings em
    JOIN events e ON e.id = em.event_id
    ORDER BY distance ASC
    LIMIT ?
  `).all(new Float32Array(queryEmbedding), limit) as SearchResult[]
}

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

export function insertTodo(db: DB, text: string): TodoRow {
  const stmt = db.prepare(`
    INSERT INTO todos (text, done, created_at) VALUES (?, 0, ?)
  `)
  const result = stmt.run(text, Math.floor(Date.now() / 1000))
  return getTodo(db, result.lastInsertRowid as number)!
}

export function getTodo(db: DB, id: number): TodoRow | undefined {
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | undefined
}

export function listTodos(db: DB, includeCompleted = false): TodoRow[] {
  const sql = includeCompleted
    ? 'SELECT * FROM todos ORDER BY created_at ASC'
    : 'SELECT * FROM todos WHERE done = 0 ORDER BY created_at ASC'
  return db.prepare(sql).all() as TodoRow[]
}

export function markTodoDone(db: DB, id: number): boolean {
  const result = db.prepare(`
    UPDATE todos SET done = 1, done_at = ? WHERE id = ? AND done = 0
  `).run(Math.floor(Date.now() / 1000), id)
  return result.changes > 0
}

export function deleteTodo(db: DB, id: number): boolean {
  const result = db.prepare('DELETE FROM todos WHERE id = ?').run(id)
  return result.changes > 0
}
