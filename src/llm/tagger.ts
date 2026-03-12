export async function generateTags(
  content: string,
  ollamaHost: string
): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(`${ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.1:8b',
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'You are a tagging assistant for a developer tool. Given a terminal command ' +
              'or OCR text from a screenshot, respond with ONLY a JSON array of 3 to 5 ' +
              'lowercase keyword tags. No explanation, no markdown, just the JSON array. ' +
              'Example: ["docker","networking","container"]',
          },
          {
            role: 'user',
            content,
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!res.ok) return []

    const data = await res.json() as unknown
    if (typeof data !== 'object' || data === null) return []

    const message = (data as Record<string, unknown>)['message']
    if (typeof message !== 'object' || message === null) return []

    let text = String((message as Record<string, unknown>)['content'] ?? '')
    // Strip markdown backtick fences the model sometimes wraps around the array
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((t): t is string => typeof t === 'string')
      .map(t => t.toLowerCase().trim())
      .filter(t => t.length > 0)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
