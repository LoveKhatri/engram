import chalk from 'chalk'
import os from 'os'
import type { Command } from 'commander'
import { loadConfig } from '../config'
import { openDb } from '../db'
import { searchEvents } from '../db/queries'
import { createProvider } from '../providers/types'

function formatAge(ts: number): string {
  const secs = Math.floor(Date.now() / 1000) - ts
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 8) return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}

function tidyPath(p: string | null): string {
  if (!p) return ''
  const home = os.homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

function truncate(s: string, max = 120): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('Search your history with natural language')
    .option('--limit <n>', 'Maximum number of results')
    .action(async (query: string, opts: { limit?: string }) => {
      const config = loadConfig()
      const limit = opts.limit ? parseInt(opts.limit, 10) : config.search.maxResults

      let db
      try {
        db = openDb()
      } catch {
        console.error('Database not found. Run: engram start')
        process.exit(1)
      }

      const provider = createProvider(config)

      let embedding: number[]
      try {
        embedding = await provider.embed(query)
      } catch {
        console.error('Could not connect to embedding provider. Is Ollama running?')
        process.exit(1)
      }

      const results = searchEvents(db, embedding, limit)

      if (results.length === 0) {
        console.log('No results found')
        return
      }

      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        const typeLabel = r.type === 'command' ? chalk.cyan('[command]') : chalk.magenta('[screenshot]')
        const age = chalk.gray(formatAge(r.created_at))
        const idx = chalk.bold(`#${i + 1}`)
        console.log(`${idx}  ${typeLabel}  ${age}`)
        console.log(`    ${truncate(r.content)}`)
        if (r.source) {
          const icon = r.type === 'command' ? '📁' : '🖼 '
          console.log(`    ${icon} ${tidyPath(r.source)}`)
        }
        console.log()
      }
    })
}
