import OpenAI from 'openai';
import type { AppConfig } from '../config.js';
import type { ProviderContext, ProviderRunResult, ReviewProvider } from './types.js';
import {
  buildSystemPrompt,
  buildUserDocumentPayload,
  parseUntrustedModelJson,
  SYSTEM_PROMPT_VERSION,
} from './types.js';

export const openaiProvider: ReviewProvider = {
  key: 'openai',
  name: 'OpenAI',
  kind: 'AI model',
  description: 'Reads for terminology consistency, translation accuracy, and numerical errors.',
  externalProcessing: true,

  getStatus(cfg: AppConfig, override) {
    const configured = Boolean(cfg.providers.openaiApiKey);
    const model = override?.model || cfg.providers.openaiModel;
    return {
      key: 'openai',
      name: this.name,
      kind: this.kind,
      description: this.description,
      enabled: override?.enabled ?? configured,
      configured,
      mode: configured ? 'live' : 'unconfigured',
      model,
      externalProcessing: true,
      notice: configured
        ? 'Connected via server OPENAI_API_KEY. Selected documents are sent to OpenAI.'
        : 'Not configured. Set OPENAI_API_KEY on the server to enable live OpenAI API analysis.',
    };
  },

  async analyze(ctx: ProviderContext, cfg: AppConfig, modelOverride?: string): Promise<ProviderRunResult> {
    if (!cfg.providers.openaiApiKey) {
      throw new Error('OpenAI API key is not configured on this server (OPENAI_API_KEY).');
    }
    const model = modelOverride || cfg.providers.openaiModel;
    const client = new OpenAI({ apiKey: cfg.providers.openaiApiKey });
    const response = await client.chat.completions.create(
      {
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt(ctx) },
          { role: 'user', content: buildUserDocumentPayload(ctx) },
        ],
      },
      { signal: ctx.signal }
    );

    const text = response.choices[0]?.message?.content || '';
    const findings = parseUntrustedModelJson(text, 'openai', model, 'live', ctx.pages.length);
    return {
      providerKey: 'openai',
      model,
      mode: 'live',
      promptVersion: SYSTEM_PROMPT_VERSION,
      findings,
    };
  },
};
