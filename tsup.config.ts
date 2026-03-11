import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'daemon/index': 'src/daemon/index.ts',
  },
  format: ['cjs'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // Don't bundle native modules — let them load from node_modules at runtime
  noExternal: [],
  external: ['better-sqlite3', 'sqlite-vec', 'tesseract.js'],
})
