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

function processLine(line: string, db: DB, provider: EmbeddingProvider): void {
  const trimmed = line.trim()
  if (!trimmed) return

  logger.debug('TCP server: received line', trimmed.slice(0, 120))

  let payload: ShellHookPayload
  try {
    payload = JSON.parse(trimmed) as ShellHookPayload
  } catch (err) {
    logger.warn('TCP server: malformed JSON line, skipping', trimmed.slice(0, 120))
    return
  }

  const event: InsertEventInput = {
    type: payload.type,
    content: payload.content,
    source: payload.source,
    exitCode: payload.exitCode,
    sessionId: payload.sessionId,
    createdAt: payload.createdAt,
  }

  logger.debug('TCP server: dispatching event to pipeline', `type=${event.type}`)

  processPipeline(event, db, provider).catch((err) => {
    logger.error('Pipeline error', err instanceof Error ? err : new Error(String(err)))
  })
}

export function startTcpServer(port: number, db: DB, provider: EmbeddingProvider): void {
  const server = net.createServer((socket) => {
    let buffer = ''

    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      logger.debug('TCP server: data received', `${chunk.length} bytes`)

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        processLine(line, db, provider)
      }
    })

    socket.on('end', () => {
      // Process any remaining data in the buffer when the connection closes
      if (buffer.trim()) {
        logger.debug('TCP server: processing remaining buffer on end')
        processLine(buffer, db, provider)
        buffer = ''
      }
    })

    socket.on('close', () => {
      if (buffer.trim()) {
        logger.debug('TCP server: processing remaining buffer on close')
        processLine(buffer, db, provider)
        buffer = ''
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
