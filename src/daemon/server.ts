import net from 'net'
import type { DB } from '../db'
import type { EmbeddingProvider } from '../providers/types'
import type { InsertEventInput } from '../db/queries'
import { processPipeline } from './pipeline'
import { logger } from '../utils/logger'

interface ShellHookPayload {
  type: 'command' | 'screenshot'
  content: string
  source: string
  exitCode: number
  sessionId: string
  createdAt: number
}

export function startTcpServer(port: number, db: DB, provider: EmbeddingProvider): void {
  const server = net.createServer((socket) => {
    let buffer = ''

    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        let payload: ShellHookPayload
        try {
          payload = JSON.parse(trimmed) as ShellHookPayload
        } catch {
          logger.warn('TCP server: malformed JSON line, skipping', trimmed)
          continue
        }

        const event: InsertEventInput = {
          type: payload.type,
          content: payload.content,
          source: payload.source,
          exitCode: payload.exitCode,
          sessionId: payload.sessionId,
          createdAt: payload.createdAt,
        }

        processPipeline(event, db, provider).catch((err) => {
          logger.error('Pipeline error', err instanceof Error ? err : new Error(String(err)))
        })
      }
    })

    socket.on('error', (err) => {
      logger.debug('TCP socket error', err)
    })
  })

  server.listen(port, '127.0.0.1', () => {
    logger.info(`TCP server listening on 127.0.0.1:${port}`)
  })

  server.on('error', (err) => {
    logger.error('TCP server error', err)
  })
}
