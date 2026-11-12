const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

export class AIRateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AIRateLimitError"
  }
}

export async function callAI<T>(prompt: string): Promise<T> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error("GROQ_API_KEY is not set in environment.")

  const model = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b"

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are a data processing assistant. Respond with valid JSON only, no markdown fences, no explanation, just the raw JSON object.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 2048,
    }),
  })

  const data = await res.json() as {
    choices?: { message?: { content?: string } }[]
    error?: { message?: string }
  }

  if (res.status === 429) {
    throw new AIRateLimitError(
      data.error?.message ?? "AI quota exceeded. Please retry in a few minutes.",
    )
  }
  if (!res.ok) {
    throw new Error(`AI error ${res.status}: ${data.error?.message ?? res.statusText}`)
  }

  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error("AI returned an empty response.")

  return JSON.parse(text) as T
}
