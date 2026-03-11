import type { EmbeddingProvider } from './types'

// TODO Phase 4: implement OllamaProvider
export class OllamaProvider implements EmbeddingProvider {
    name = 'ollama'

    constructor(private config: { host: string; model: string }) { }

    async embed(_text: string): Promise<number[]> {
        throw new Error('OllamaProvider not yet implemented')
    }
}