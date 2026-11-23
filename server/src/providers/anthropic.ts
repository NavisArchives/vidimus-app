import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config.js';
import type { ProviderContext, ProviderRunResult, ReviewProvider } from './types.js';
import {
  buildSystemPrompt,
  buildUserDocumentPayload,
  parseUntrustedModelJson,
  SYSTEM_PROMPT_VERSION,
} from './types.js';

export const anthropicProvider: ReviewProvider = {
  key: 'anthropic',
  name: 'Claude',
  kind: 'AI model',
  description: 'Reads for figures, references, regulatory risks, and internal consistency.',
  externalProcessing: true,

  getStatus(cfg: AppConfig, override) {
    const configured = Boolean(cfg.providers.anthropicApiKey);
    const model = override?.model || cfg.providers.anthropicModel;
    return {
      key: 'anthropic',
      name: this.name,
      kind: this.kind,
      description: this.description,
      enabled: override?.enabled ?? configured,
      configured,
      mode: configured ? 'live' : 'unconfigured',
      model,
      externalProcessing: true,
      notice: configured
        ? 'Connected via server ANTHROPIC_API_KEY. Selected documents are sent to Anthropic.'
        : 'Not configured. Set ANTHROPIC_API_KEY on the server to enable live Anthropic API analysis.',
    };
  },

  async analyze(ctx: ProviderContext, cfg: AppConfig, modelOverride?: string): Promise<ProviderRunResult> {
    if (!cfg.providers.anthropicApiKey) {
      throw new Error('Anthropic API key is not configured on this server (ANTHROPIC_API_KEY).');
    }
    const model = modelOverride || cfg.providers.anthropicModel;
    const client = new Anthropic({ apiKey: cfg.providers.anthropicApiKey });
    const response = await client.messages.create(
      {
        model,
        max_tokens: 4096,
        temperature: 0.1,
        system: buildSystemPrompt(ctx),
        messages: [{ role: 'user', content: buildUserDocumentPayload(ctx) }],
      },
      { signal: ctx.signal }
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    const findings = parseUntrustedModelJson(text, 'anthropic', model, 'live', ctx.pages.length);
    return {
      providerKey: 'anthropic',
      model,
      mode: 'live',
      promptVersion: SYSTEM_PROMPT_VERSION,
      findings,
    };
  },
};
