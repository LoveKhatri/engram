import type { EmbeddingProvider } from './types'

interface GeminiEmbedResponse {
  embedding: {
    values: number[]
  }
}

export class GeminiProvider implements EmbeddingProvider {
  name = 'gemini'

  constructor(private config: { model: string; apiKey?: string }) {}

  async embed(text: string): Promise<number[]> {
    const apiKey = this.config.apiKey
    if (!apiKey) {
      throw new Error('Gemini API key not set. Provide it via GEMINI_API_KEY env var.')
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:embedContent?key=${apiKey}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.config.model}`,
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Gemini request failed (${res.status}): ${body}`)
    }

    const data = await res.json() as unknown

    if (
      typeof data !== 'object' ||
      data === null ||
      !Array.isArray((data as GeminiEmbedResponse).embedding?.values)
    ) {
      throw new Error(`Gemini response missing embedding values: ${JSON.stringify(data)}`)
    }

    return (data as GeminiEmbedResponse).embedding.values
  }
}
