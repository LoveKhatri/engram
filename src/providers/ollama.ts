import type { EmbeddingProvider } from './types'

export class OllamaProvider implements EmbeddingProvider {
  name = 'ollama'

  constructor(private config: { host: string; model: string }) {}

  async embed(text: string): Promise<number[]> {
    const url = `${this.config.host}/api/embeddings`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, prompt: text }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Ollama request failed (${res.status}): ${body}`)
    }

    const data = await res.json() as unknown
    if (
      typeof data !== 'object' ||
      data === null ||
      !Array.isArray((data as Record<string, unknown>)['embedding'])
    ) {
      throw new Error(`Ollama response missing embedding array: ${JSON.stringify(data)}`)
    }

    return (data as { embedding: number[] }).embedding
  }
}
