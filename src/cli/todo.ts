import Table from 'cli-table3'
import type { Command } from 'commander'
import { openDb } from '../db'
import { insertTodo, listTodos, markTodoDone, deleteTodo, getTodo } from '../db/queries'

function getDb() {
  try {
    return openDb()
  } catch {
    console.error('Database not found. Run: engram start')
    process.exit(1)
  }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export function registerTodoCommands(program: Command): void {
  const todo = program.command('todo').description('Manage todos')

  todo
    .command('add <text>')
    .description('Add a todo item')
    .action((text: string) => {
      const db = getDb()
      const row = insertTodo(db, text)
      console.log(`Added #${row.id}: ${row.text}`)
    })

  todo
    .command('list')
    .description('List open todos')
    .option('--all', 'Include completed todos')
    .action((opts: { all?: boolean }) => {
      const db = getDb()
      const rows = listTodos(db, opts.all ?? false)

      if (rows.length === 0) {
        console.log('No todos. Add one with: engram todo add <text>')
        return
      }

      const table = new Table({ head: ['ID', 'Text', 'Added'] })
      for (const row of rows) {
        const prefix = row.done ? '✓ ' : ''
        table.push([String(row.id), `${prefix}${row.text}`, formatDate(row.created_at)])
      }
      console.log(table.toString())
    })

  todo
    .command('done <id>')
    .description('Mark a todo as done')
    .action((idStr: string) => {
      const id = parseInt(idStr, 10)
      if (isNaN(id)) {
        console.error(`Invalid id: ${idStr}`)
        process.exit(1)
      }
      const db = getDb()
      const ok = markTodoDone(db, id)
      if (!ok) {
        console.log(`Todo #${id} not found or already done`)
        return
      }
      const row = getTodo(db, id)
      console.log(`✓ Done: ${row?.text ?? ''}`)
    })

  todo
    .command('delete <id>')
    .description('Delete a todo')
    .action((idStr: string) => {
      const id = parseInt(idStr, 10)
      if (isNaN(id)) {
        console.error(`Invalid id: ${idStr}`)
        process.exit(1)
      }
      const db = getDb()
      const ok = deleteTodo(db, id)
      if (!ok) {
        console.log(`Todo #${id} not found`)
        return
      }
      console.log(`Deleted #${id}`)
    })
}
