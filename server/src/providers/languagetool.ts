import type { CandidateFinding } from '@vidimus/shared';
import type { AppConfig } from '../config.js';
import type { ProviderContext, ProviderRunResult, ReviewProvider } from './types.js';

interface LtMatch {
  message: string;
  offset: number;
  length: number;
  replacements: Array<{ value: string }>;
  rule: { id: string; issueType?: string; category?: { name?: string } };
}

export const languagetoolProvider: ReviewProvider = {
  key: 'languagetool',
  name: 'LanguageTool',
  kind: 'Language check',
  description: 'Spelling, grammar, and language checks via a local or configured LanguageTool server.',
  externalProcessing: false,

  getStatus(cfg: AppConfig, override) {
    const configured = Boolean(cfg.providers.languagetoolUrl);
    const url = cfg.providers.languagetoolUrl || 'http://127.0.0.1:8081/v2/check';
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    return {
      key: 'languagetool',
      name: this.name,
      kind: this.kind,
      description: this.description,
      enabled: override?.enabled ?? configured,
      configured,
      mode: configured ? 'live' : 'unconfigured',
      model: isLocal ? 'local-server' : 'remote-api',
      externalProcessing: !isLocal,
      notice: configured
        ? `Connected to ${isLocal ? 'local' : 'configured'} LanguageTool endpoint.`
        : 'Not configured. Set LANGUAGETOOL_URL (e.g. http://127.0.0.1:8081/v2/check) to enable live LanguageTool checks.',
    };
  },

  async analyze(ctx: ProviderContext, cfg: AppConfig): Promise<ProviderRunResult> {
    if (!cfg.providers.languagetoolUrl) {
      throw new Error('LanguageTool server URL is not configured (LANGUAGETOOL_URL).');
    }
    const langCode = ctx.targetLang || ctx.sourceLang || 'en-GB';
    const findings: CandidateFinding[] = [];
    const now = new Date().toISOString();

    for (const page of ctx.pages) {
      if (ctx.signal.aborted) throw new Error('Review cancelled');
      if (!page.text.trim()) continue;
      const body = new URLSearchParams({
        text: page.text.slice(0, 18000),
        language: langCode,
        level: 'picky',
      });
      const res = await fetch(cfg.providers.languagetoolUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: ctx.signal,
      });
      if (!res.ok) {
        throw new Error(`LanguageTool returned HTTP ${res.status}`);
      }
      const json = (await res.json()) as { matches?: LtMatch[] };
      for (const m of (json.matches || []).slice(0, 30)) {
        const replacement = m.replacements?.[0]?.value;
        if (!replacement) continue;
        // Expand quote slightly around the match so it anchors uniquely on the page
        const start = Math.max(0, m.offset - 12);
        const end = Math.min(page.text.length, m.offset + m.length + 12);
        const quote = page.text.slice(start, end).trim();
        const relStart = m.offset - start;
        const suggestion =
          (page.text.slice(start, m.offset) + replacement + page.text.slice(m.offset + m.length, end)).trim();
        if (quote.length < 3 || quote === suggestion || relStart < 0) continue;
        findings.push({
          page: page.page,
          severity: m.rule.issueType === 'misspelling' ? 'medium' : 'low',
          category: 'language',
          title: m.message.replace(/\.$/, '').slice(0, 120),
          quote,
          suggestion,
          explanation: `${m.message} (Rule: ${m.rule.id}).`,
          providerKey: 'languagetool',
          model: 'languagetool-v2',
          mode: 'live',
          promptVersion: 'lt-picky-v2',
          createdAt: now,
        });
      }
    }

    return {
      providerKey: 'languagetool',
      model: 'languagetool-v2',
      mode: 'live',
      promptVersion: 'lt-picky-v2',
      findings,
    };
  },
};
