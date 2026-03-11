import fs from 'fs'
import path from 'path'
import TOML from 'toml'
import { paths } from '../utils/paths'

export interface EngramConfig {
    provider: { type: 'ollama' | 'gemini' }
    ollama: { host: string; model: string }
    gemini: { model: string; apiKey?: string }
    screenshots: { watchDir: string }
    daemon: { port: number }
    search: { maxResults: number }
}

const DEFAULTS: EngramConfig = {
    provider: { type: 'ollama' },
    ollama: { host: 'http://localhost:11434', model: 'nomic-embed-text' },
    gemini: { model: 'text-embedding-004' },
    screenshots: { watchDir: '' },
    daemon: { port: 7842 },
    search: { maxResults: 10 },
}

function deepMerge<T>(defaults: T, overrides: Partial<T>): T {
    const result = { ...defaults }
    for (const key of Object.keys(overrides) as Array<keyof T>) {
        const val = overrides[key]
        if (val !== undefined && val !== null) {
            if (typeof val === 'object' && !Array.isArray(val)) {
                result[key] = deepMerge(defaults[key] as object, val as object) as T[keyof T]
            } else {
                result[key] = val as T[keyof T]
            }
        }
    }
    return result
}

function applyEnvOverrides(config: EngramConfig): EngramConfig {
    const c = structuredClone(config)

    const provider = process.env['ENGRAM_PROVIDER']
    if (provider === 'ollama' || provider === 'gemini') c.provider.type = provider

    if (process.env['ENGRAM_OLLAMA_HOST']) c.ollama.host = process.env['ENGRAM_OLLAMA_HOST']!
    if (process.env['ENGRAM_OLLAMA_MODEL']) c.ollama.model = process.env['ENGRAM_OLLAMA_MODEL']!
    if (process.env['GEMINI_API_KEY']) c.gemini.apiKey = process.env['GEMINI_API_KEY']!

    const port = process.env['ENGRAM_DAEMON_PORT']
    if (port && !isNaN(parseInt(port))) c.daemon.port = parseInt(port)

    if (process.env['ENGRAM_SCREENSHOTS_DIR']) c.screenshots.watchDir = process.env['ENGRAM_SCREENSHOTS_DIR']!

    return c
}

// Converts TOML snake_case keys to our camelCase config shape
// TOML has watch_dir, max_results — we normalise here
function normaliseParsed(raw: Record<string, unknown>): Partial<EngramConfig> {
    const result: Partial<EngramConfig> = {}

    if (raw['provider']) result.provider = raw['provider'] as EngramConfig['provider']
    if (raw['ollama']) result.ollama = raw['ollama'] as EngramConfig['ollama']
    if (raw['gemini']) result.gemini = raw['gemini'] as EngramConfig['gemini']

    if (raw['daemon']) result.daemon = raw['daemon'] as EngramConfig['daemon']

    if (raw['screenshots']) {
        const ss = raw['screenshots'] as Record<string, unknown>
        result.screenshots = { watchDir: (ss['watch_dir'] as string) ?? '' }
    }

    if (raw['search']) {
        const s = raw['search'] as Record<string, unknown>
        result.search = { maxResults: (s['max_results'] as number) ?? DEFAULTS.search.maxResults }
    }

    return result
}

export function configPath(): string {
    return paths.configFile
}

export function loadConfig(): EngramConfig {
    let fromFile: Partial<EngramConfig> = {}

    if (fs.existsSync(paths.configFile)) {
        try {
            const raw = TOML.parse(fs.readFileSync(paths.configFile, 'utf-8'))
            fromFile = normaliseParsed(raw)
        } catch {
            // Malformed config — fall back to defaults silently
        }
    }

    const merged = deepMerge(DEFAULTS, fromFile)
    return applyEnvOverrides(merged)
}

export function saveConfig(partial: Partial<EngramConfig>): void {
    fs.mkdirSync(path.dirname(paths.configFile), { recursive: true })

    const current = loadConfig()
    const updated = deepMerge(current, partial)

    // Serialise back to TOML manually (the `toml` package is parse-only)
    const lines = [
        `[provider]`,
        `type = "${updated.provider.type}"`,
        ``,
        `[ollama]`,
        `host = "${updated.ollama.host}"`,
        `model = "${updated.ollama.model}"`,
        ``,
        `[gemini]`,
        `# api_key should be set via GEMINI_API_KEY env var`,
        `model = "${updated.gemini.model}"`,
        ``,
        `[screenshots]`,
        `watch_dir = "${updated.screenshots.watchDir}"`,
        ``,
        `[daemon]`,
        `port = ${updated.daemon.port}`,
        ``,
        `[search]`,
        `max_results = ${updated.search.maxResults}`,
        ``,
    ]

    fs.writeFileSync(paths.configFile, lines.join('\n'), 'utf-8')
}