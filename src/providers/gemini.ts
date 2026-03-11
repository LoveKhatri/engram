import type { EmbeddingProvider } from './types'

// TODO Phase 4: implement GeminiProvider
export class GeminiProvider implements EmbeddingProvider {
    name = 'gemini'

    constructor(private config: { model: string; apiKey?: string }) { }

    async embed(_text: string): Promise<number[]> {
        throw new Error('GeminiProvider not yet implemented')
    }
}