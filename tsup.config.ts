import { defineConfig } from 'tsup'
import fs from 'fs'

// Dynamically include all migration files as separate entry points so they
// land at dist/db/migrations/<name>.js and can be require()'d at runtime.
const migrationEntries = Object.fromEntries(
  fs.readdirSync('src/db/migrations')
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map(f => [`db/migrations/${f.replace('.ts', '')}`, `src/db/migrations/${f}`])
)

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'daemon/index': 'src/daemon/index.ts',
    ...migrationEntries,
  },
  format: ['cjs'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // Don't bundle native modules — let them load from node_modules at runtime
  noExternal: [],
  external: ['better-sqlite3', 'sqlite-vec', 'tesseract.js', 'express', '@inquirer/prompts'],
})
