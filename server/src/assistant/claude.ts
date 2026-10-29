import Anthropic from '@anthropic-ai/sdk'

/**
 * Asking Claude (ADR 0096), through Anthropic's API, for an answer in a
 * JSON schema. Only this file talks to Anthropic; the routes are given an
 * `Ask` so tests stand in for it without the network.
 */

export interface Asked {
  system: string
  /** What's sent as the person's turn: the enquiry or the quote and what was asked. */
  user: string
  schema: Record<string, unknown>
  maxTokens: number
}

export interface Answer {
  /** The answer as JSON, read but not yet checked. */
  json: unknown
  model: string
  inputTokens: number
  outputTokens: number
}

export type Ask = (a: Asked) => Promise<Answer>

/** Claude couldn't give an answer, with a reason for the office. What it cost is counted all the same. */
export class NoAnswer extends Error {
  override name = 'NoAnswer'
  constructor(
    message: string,
    readonly used?: Omit<Answer, 'json'>
  ) {
    super(message)
  }
}

export interface ClaudeConfig {
  apiKey: string
  model: string
  /** What it may spend in a month, in US cents. */
  limitCents: number
  /** Stands in for Anthropic in tests. */
  ask?: Ask
}

/** Anthropic's API, asked once with a retry or two for a busy moment; a minute and a half at most. */
export function anthropicAsk(apiKey: string, model: string): Ask {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 })
  return async ({ system, user, schema, maxTokens }) => {
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      // Low effort: reading an enquiry into lines is quick work, and the office is waiting on the screen.
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    })
    const used = { model: res.model, inputTokens: res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0), outputTokens: res.usage.output_tokens }
    if (res.stop_reason === 'refusal') throw new NoAnswer('Claude wouldn’t answer that one.', used)
    if (res.stop_reason === 'max_tokens') throw new NoAnswer('Claude’s answer was too long to finish. Try a shorter enquiry, or part of it.', used)
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    try {
      return { ...used, json: JSON.parse(text) }
    } catch {
      throw new NoAnswer('Claude’s answer couldn’t be read. Try again.', used)
    }
  }
}
