import { GoogleGenAI } from '@google/genai';
import type { AppConfig } from '../config.js';
import type { ProviderContext, ProviderRunResult, ReviewProvider } from './types.js';
import {
  buildSystemPrompt,
  buildUserDocumentPayload,
  parseUntrustedModelJson,
  SYSTEM_PROMPT_VERSION,
} from './types.js';

export const geminiProvider: ReviewProvider = {
  key: 'gemini',
  name: 'Gemini',
  kind: 'AI model',
  description: 'Cross-checks dates, calculations, proper names, and document structure.',
  externalProcessing: true,

  getStatus(cfg: AppConfig, override) {
    const configured = Boolean(cfg.providers.geminiApiKey);
    const model = override?.model || cfg.providers.geminiModel;
    return {
      key: 'gemini',
      name: this.name,
      kind: this.kind,
      description: this.description,
      enabled: override?.enabled ?? configured,
      configured,
      mode: configured ? 'live' : 'unconfigured',
      model,
      externalProcessing: true,
      notice: configured
        ? 'Connected via server GEMINI_API_KEY. Selected documents are sent to Google Gemini.'
        : 'Not configured. Set GEMINI_API_KEY on the server to enable live Gemini API analysis.',
    };
  },

  async analyze(ctx: ProviderContext, cfg: AppConfig, modelOverride?: string): Promise<ProviderRunResult> {
    if (!cfg.providers.geminiApiKey) {
      throw new Error('Gemini API key is not configured on this server (GEMINI_API_KEY).');
    }
    const model = modelOverride || cfg.providers.geminiModel;
    const ai = new GoogleGenAI({ apiKey: cfg.providers.geminiApiKey });
    const response = await ai.models.generateContent({
      model,
      contents: buildUserDocumentPayload(ctx),
      config: {
        systemInstruction: buildSystemPrompt(ctx),
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const text = response.text || '';
    const findings = parseUntrustedModelJson(text, 'gemini', model, 'live', ctx.pages.length);
    return {
      providerKey: 'gemini',
      model,
      mode: 'live',
      promptVersion: SYSTEM_PROMPT_VERSION,
      findings,
    };
  },
};
