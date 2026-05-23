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
import fs from 'fs';

// Detect whether we are running inside a Docker container.
// Rewrite localhost → host.docker.internal so local AI backends (e.g. Ollama)
// remain reachable. Docker Desktop injects this mapping automatically;
// on Linux we rely on '--add-host=host.docker.internal:host-gateway'.
const IS_HOST_NETWORK_PROVIDER = process.env.VERFIX_HOST_NETWORK === '1';
const IS_DOCKER_PROVIDER =
  !IS_HOST_NETWORK_PROVIDER && (
    process.env.IN_DOCKER === '1' ||
    fs.existsSync('/.dockerenv')
  );

function resolveBaseUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  // Host network mode: localhost reaches the host directly, no rewrite.
  if (IS_HOST_NETWORK_PROVIDER) return url;
  // Not in Docker: no rewrite.
  if (!IS_DOCKER_PROVIDER) return url;
  // Bridge mode: rewrite localhost → host.docker.internal.
  return url.replace(
    /\/\/(localhost|127\.0\.0\.1)(:\d+)?/g,
    '//host.docker.internal$2',
  );
}

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (client) return client;

  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null; // AI disabled — this is fine
  }

  const baseURL = resolveBaseUrl(process.env.AI_BASE_URL || undefined);
  if (baseURL && baseURL !== (process.env.AI_BASE_URL || undefined)) {
    console.log(`  ℹ️  AI_BASE_URL rewritten for Docker: ${process.env.AI_BASE_URL} → ${baseURL}`);
  }

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
