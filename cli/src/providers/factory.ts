import type { AIProvider, ProviderId } from './types';

/**
 * Factory function that creates a provider instance by ID.
 * Provider modules are imported lazily to avoid loading all implementations at startup.
 */
export async function createProvider(id: ProviderId): Promise<AIProvider> {
  switch (id) {
    case 'openai': {
      const { OpenAIProvider } = await import('./openai');
      return new OpenAIProvider();
    }
    case 'anthropic': {
      const { AnthropicProvider } = await import('./anthropic');
      return new AnthropicProvider();
    }
    case 'gemini': {
      const { GeminiProvider } = await import('./gemini');
      return new GeminiProvider();
    }
    case 'openrouter': {
      const { OpenRouterProvider } = await import('./openrouter');
      return new OpenRouterProvider();
    }
    default: {
      throw new Error(`Unknown provider: ${id}`);
    }
  }
}

/**
 * Synchronous factory that creates a provider instance by ID.
 * Uses synchronous require() for use in contexts where async isn't possible.
 */
export function createProviderInstance(id: ProviderId): AIProvider {
  switch (id) {
    case 'openai': {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { OpenAIProvider } = require('./openai');
      return new OpenAIProvider();
    }
    case 'anthropic': {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { AnthropicProvider } = require('./anthropic');
      return new AnthropicProvider();
    }
    case 'gemini': {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GeminiProvider } = require('./gemini');
      return new GeminiProvider();
    }
    case 'openrouter': {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { OpenRouterProvider } = require('./openrouter');
      return new OpenRouterProvider();
    }
    default: {
      throw new Error(`Unknown provider: ${id}`);
    }
  }
}
