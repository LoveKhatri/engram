import chalk from 'chalk'
import os from 'os'
import { spawnSync } from 'child_process'
import Table from 'cli-table3'
import type { Command } from 'commander'
import { loadConfig } from '../config'
import { openDb } from '../db'
import { hybridSearch, getTagsForEvents } from '../db/queries'
import { createProvider } from '../providers/types'

function formatAge(ts: number): string {
  const secs = Math.floor(Date.now() / 1000) - ts
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 8) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function tidyPath(p: string | null): string {
  if (!p) return ''
  const home = os.homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

function quotePath(p: string): string {
  return p.includes(' ') ? `"${p}"` : p
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
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

      const results = hybridSearch(db, embedding, query, limit)

      if (results.length === 0) {
        console.log('No results found')
        return
      }

      // Fetch tags for all results in one batch query
      let tagsMap = new Map<number, string[]>()
      try {
        tagsMap = getTagsForEvents(db, results.map(r => r.id))
      } catch {
        // tags table might not exist yet — ignore
      }

      const table = new Table({
        head: [
          chalk.bold('#'),
          chalk.bold('Type'),
          chalk.bold('Content'),
          chalk.bold('Directory / Path'),
          chalk.bold('When'),
        ],
        style: { head: [], border: [] },
        colWidths: [4, 12, 52, 36, 12],
        wordWrap: true,
      })

      for (let i = 0; i < results.length; i++) {
        const r = results[i]!
        const isScreenshot = r.type === 'screenshot'

        const typeCell = isScreenshot
          ? chalk.magenta('screenshot')
          : chalk.cyan('command')

        const sourcePath = r.source || ''
        // For screenshots: show file path, quoting if it contains spaces
        const contentCell = isScreenshot
          ? chalk.yellow(quotePath(tidyPath(sourcePath)))
          : truncate(r.content, 50)

        const dirCell = isScreenshot
          ? ''
          : chalk.gray(tidyPath(sourcePath))

        const tags = tagsMap.get(r.id) ?? []
        const tagStr = tags.length > 0 ? chalk.blue('\n\uD83C\uDFF7  ' + tags.join('  ')) : ''

        const whenCell = chalk.gray(formatAge(r.created_at))

        table.push([String(i + 1), typeCell, contentCell + tagStr, dirCell, whenCell])
      }

      console.log(table.toString())

      // --- Interactive command selector ---
      const commandResults = results
        .map((r, i) => ({ ...r, displayIndex: i + 1 }))
        .filter(r => r.type === 'command')

      if (commandResults.length === 0) return

      const choices: Array<{ name: string; value: string | null }> = commandResults.map(r => ({
        name: `#${r.displayIndex} — ${truncate(r.content, 70)}`,
        value: r.content,
      }))
      choices.push({ name: 'Cancel', value: null })

      let chosen: string | null = null
      try {
        // Dynamic import handles ESM-only @inquirer/prompts from CJS
        const { select } = await import('@inquirer/prompts')
        chosen = await select<string | null>({
          message: 'Run a command? (arrow keys, Enter to select)',
          choices,
        })
      } catch {
        // Ctrl+C or prompt error — exit cleanly
        process.exit(0)
      }

      if (chosen === null) return

      // Try to copy to clipboard via xclip, then xsel
      let copied = false
      const clip1 = spawnSync('xclip', ['-selection', 'clipboard'], {
        input: chosen,
        stdio: ['pipe', 'ignore', 'ignore'],
      })
      if (clip1.status === 0) {
        copied = true
      } else {
        const clip2 = spawnSync('xsel', ['--clipboard', '--input'], {
          input: chosen,
          stdio: ['pipe', 'ignore', 'ignore'],
        })
        if (clip2.status === 0) copied = true
      }

      if (copied) {
        console.log(`\u2713 Copied to clipboard: ${chosen}`)
      } else {
        console.log(`\u2713 Selected: ${chosen}`)
        console.log(chosen)
      }
    })
}
