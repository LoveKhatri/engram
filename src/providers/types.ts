import type { EngramConfig } from '../config'

export interface EmbeddingProvider {
    embed(text: string): Promise<number[]>
    name: string
}

export function createProvider(config: EngramConfig): EmbeddingProvider {
    switch (config.provider.type) {
        case 'ollama': {
            const { OllamaProvider } = require('./ollama')
            return new OllamaProvider(config.ollama)
        }
        case 'gemini': {
            const { GeminiProvider } = require('./gemini')
            return new GeminiProvider(config.gemini)
        }
        default:
            throw new Error(`Unknown provider: ${(config.provider as { type: string }).type}`)
    }
}