/**
 * AI Provider — provider-agnostic LLM interface.
 * 
 * Supports:
 *   - OpenAI API (GPT-4o, GPT-4o-mini, etc.)
 *   - Any OpenAI-compatible API (Ollama, Groq, Together, etc.)
 *   - Disabled mode (no API key = skip gracefully)
 * 
 * ARCHITECTURAL RULE: This is Layer 2. It is NEVER on the critical path.
 * Failures here should log and return null, never throw.
 */

import OpenAI from 'openai';

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (client) return client;

  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null; // AI disabled — this is fine
  }

  const baseURL = process.env.AI_BASE_URL || undefined; // Ollama: http://localhost:11434/v1

  client = new OpenAI({ apiKey, baseURL });
  return client;
}

export function isAIEnabled(): boolean {
  return !!(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
}

export function getModelName(): string {
  return process.env.AI_MODEL || 'gpt-4o-mini';
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; json?: boolean },
): Promise<string | null> {
  const c = getClient();
  if (!c) return null;

  try {
    const payload: any = {
      model: getModelName(),
      messages,
      temperature: opts?.temperature ?? 0.3,
    };

    if (opts?.json) {
      payload.response_format = { type: 'json_object' };
    }

    if (opts?.maxTokens) {
      payload.max_tokens = opts.maxTokens;
    }

    try {
      const response = await c.chat.completions.create(payload);
      return response.choices[0]?.message?.content ?? null;
    } catch (e: any) {
      // If the model rejects max_tokens (e.g. o1 models, or proxy models), try max_completion_tokens
      if (e.message?.includes('max_tokens') && e.message?.includes('max_completion_tokens')) {
        delete payload.max_tokens;
        payload.max_completion_tokens = opts?.maxTokens;
        const retryResponse = await c.chat.completions.create(payload);
        return retryResponse.choices[0]?.message?.content ?? null;
      }
      throw e;
    }
  } catch (error: any) {
    console.warn(`  ⚠ AI provider error: ${error.message}`);
    return null;
  }
}
