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
  const row = insertEvent(db, event)

  try {
    const embedding = await provider.embed(event.content)
    insertEmbedding(db, row.id, embedding)
  } catch (err) {
    logger.warn(
      `Failed to embed event ${row.id} — re-run 'engram reindex' later`,
      err instanceof Error ? err : new Error(String(err))
    )
  }
}
