import path from 'path'
import chokidar from 'chokidar'
import type { DB } from '../db'
import type { EmbeddingProvider } from '../providers/types'
import { extractText } from '../ocr'
import { processPipeline } from './pipeline'
import { logger } from '../utils/logger'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export async function startScreenshotWatcher(
  dir: string,
  db: DB,
  provider: EmbeddingProvider
): Promise<void> {
  const watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
  })

  watcher.on('add', (filePath: string) => {
    if (!IMAGE_EXTS.has(path.extname(filePath).toLowerCase())) return

    ;(async () => {
      const text = await extractText(filePath)
      if (!text) return

      await processPipeline(
        {
          type: 'screenshot',
          content: text,
          source: filePath,
          createdAt: Math.floor(Date.now() / 1000),
        },
        db,
        provider
      )
    })().catch((err) => {
      logger.warn(
        `Failed to process screenshot: ${filePath}`,
        err instanceof Error ? err : new Error(String(err))
      )
    })
  })

  watcher.on('error', (err) => {
    logger.error('Screenshot watcher error', err instanceof Error ? err : new Error(String(err)))
  })

  logger.info(`Screenshot watcher started: ${dir}`)
}
