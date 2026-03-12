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

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export function upsertTag(db: DB, name: string): number {
  db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name)
  const row = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }
  return row.id
}

export function setEventTags(db: DB, eventId: number, tags: string[]): void {
  db.prepare('DELETE FROM event_tags WHERE event_id = ?').run(eventId)
  for (const tag of tags) {
    const tagId = upsertTag(db, tag)
    db.prepare('INSERT OR IGNORE INTO event_tags (event_id, tag_id) VALUES (?, ?)').run(eventId, tagId)
  }
}

export function getEventTags(db: DB, eventId: number): string[] {
  const rows = db.prepare(`
    SELECT t.name FROM tags t
    JOIN event_tags et ON et.tag_id = t.id
    WHERE et.event_id = ?
    ORDER BY t.name
  `).all(eventId) as { name: string }[]
  return rows.map(r => r.name)
}

export function getTagsForEvents(db: DB, eventIds: number[]): Map<number, string[]> {
  if (eventIds.length === 0) return new Map()
  const placeholders = eventIds.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT et.event_id, t.name
    FROM event_tags et
    JOIN tags t ON t.id = et.tag_id
    WHERE et.event_id IN (${placeholders})
    ORDER BY et.event_id, t.name
  `).all(...eventIds) as { event_id: number; name: string }[]
  const map = new Map<number, string[]>()
  for (const row of rows) {
    const arr = map.get(row.event_id) ?? []
    arr.push(row.name)
    map.set(row.event_id, arr)
  }
  return map
}

export function listAllTags(db: DB): Array<{ name: string; count: number }> {
  return db.prepare(`
    SELECT t.name, COUNT(et.event_id) AS count
    FROM tags t
    LEFT JOIN event_tags et ON et.tag_id = t.id
    GROUP BY t.id
    ORDER BY count DESC, t.name ASC
  `).all() as Array<{ name: string; count: number }>
}

// ---------------------------------------------------------------------------
// Hybrid search (Reciprocal Rank Fusion: vector + FTS5)
// ---------------------------------------------------------------------------

export function hybridSearch(
  db: DB,
  queryEmbedding: number[],
  queryText: string,
  limit: number
): SearchResult[] {
  // 1. Vector search — top (limit * 2)
  const vectorRows = db.prepare(`
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
  `).all(new Float32Array(queryEmbedding), limit * 2) as SearchResult[]

  const vectorRankMap = new Map<number, number>()
  vectorRows.forEach((r, i) => vectorRankMap.set(r.id, i + 1))

  // 2. FTS5 search — top (limit * 2), wrapped in try/catch in case table missing or query invalid
  const ftsIds: number[] = []
  try {
    const ftsRows = db.prepare(`
      SELECT rowid AS id
      FROM events_fts
      WHERE events_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(queryText, limit * 2) as { id: number }[]
    for (const r of ftsRows) ftsIds.push(r.id)
  } catch {
    // FTS table not available or malformed query — fall back to vector-only
  }

  const ftsRankMap = new Map<number, number>()
  ftsIds.forEach((id, i) => ftsRankMap.set(id, i + 1))

  // 3. Merge all ids and compute RRF scores
  const allIds = new Set<number>([...vectorRows.map(r => r.id), ...ftsIds])
  const scores = new Map<number, number>()
  for (const id of allIds) {
    let score = 0
    const vRank = vectorRankMap.get(id)
    const fRank = ftsRankMap.get(id)
    if (vRank !== undefined) score += 1 / (60 + vRank)
    if (fRank !== undefined) score += 1 / (60 + fRank)
    scores.set(id, score)
  }

  // 4. Sort by RRF score descending, take top limit
  const sortedIds = [...allIds]
    .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
    .slice(0, limit)

  // 5. Build event row map — fetch any IDs not already in vectorRows
  const eventMap = new Map<number, SearchResult>()
  for (const r of vectorRows) eventMap.set(r.id, r)

  const missingIds = sortedIds.filter(id => !eventMap.has(id))
  if (missingIds.length > 0) {
    const ph = missingIds.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT *, 0.0 AS distance FROM events WHERE id IN (${ph})`
    ).all(...missingIds) as SearchResult[]
    for (const r of rows) eventMap.set(r.id, r)
  }

  // 6. Return final results — distance field holds RRF score (higher = better)
  return sortedIds
    .map(id => {
      const event = eventMap.get(id)
      if (!event) return null
      return { ...event, distance: scores.get(id) ?? 0 }
    })
    .filter((r): r is SearchResult => r !== null)
}
