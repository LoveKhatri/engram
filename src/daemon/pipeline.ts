import type { DB } from '../db'
import type { EmbeddingProvider } from '../providers/types'
import { insertEvent, insertEmbedding } from '../db/queries'
import type { InsertEventInput } from '../db/queries'
import { logger } from '../utils/logger'

export async function processPipeline(
  event: InsertEventInput,
  db: DB,
  provider: EmbeddingProvider
): Promise<void> {
  logger.debug('Pipeline: inserting event', `type=${event.type} content="${event.content.slice(0, 60)}"`)
  const row = insertEvent(db, event)
  logger.debug('Pipeline: event inserted', `id=${row.id}`)

  try {
    logger.debug('Pipeline: requesting embedding', `event_id=${row.id}`)
    const embedding = await provider.embed(event.content)
    logger.debug('Pipeline: embedding received', `event_id=${row.id} dims=${embedding.length}`)
    insertEmbedding(db, row.id, embedding)
    logger.debug('Pipeline: embedding stored', `event_id=${row.id}`)
  } catch (err) {
    logger.warn(
      `Failed to embed event ${row.id} — re-run 'engram reindex' later`,
      err instanceof Error ? err : new Error(String(err))
    )
  }
}
