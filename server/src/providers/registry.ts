import type { ProviderKey, ProviderStatusDTO } from '@vidimus/shared';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import { anthropicProvider } from './anthropic.js';
import { deterministicProvider } from './deterministic.js';
import { geminiProvider } from './gemini.js';
import { languagetoolProvider } from './languagetool.js';
import { openaiProvider } from './openai.js';
import type { ReviewProvider } from './types.js';

export const DEFAULT_PROVIDERS: ReviewProvider[] = [
  anthropicProvider,
  openaiProvider,
  geminiProvider,
  languagetoolProvider,
  deterministicProvider,
];

export class ProviderRegistry {
  private readonly providers = new Map<ProviderKey, ReviewProvider>();

  constructor(list: ReviewProvider[] = DEFAULT_PROVIDERS) {
    for (const p of list) {
      this.providers.set(p.key, p);
    }
  }

  register(provider: ReviewProvider): void {
    this.providers.set(provider.key, provider);
  }

  get(key: ProviderKey): ReviewProvider | undefined {
    return this.providers.get(key);
  }

  listStatuses(db: Db, workspaceId: string, cfg: AppConfig): ProviderStatusDTO[] {
    const rows = db
      .prepare('SELECT provider_key, enabled, model FROM provider_configs WHERE workspace_id = ?')
      .all(workspaceId) as Array<{ provider_key: string; enabled: number; model: string }>;
    const overrides = new Map(
      rows.map((r) => [r.provider_key, { enabled: Boolean(r.enabled), model: r.model || undefined }])
    );
    return [...this.providers.values()].map((p) => p.getStatus(cfg, overrides.get(p.key)));
  }

  updateWorkspaceConfig(
    db: Db,
    workspaceId: string,
    providerKey: ProviderKey,
    enabled: boolean,
    model?: string
  ): void {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO provider_configs (workspace_id, provider_key, enabled, model, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, provider_key)
       DO UPDATE SET enabled = excluded.enabled, model = CASE WHEN excluded.model != '' THEN excluded.model ELSE provider_configs.model END, updated_at = excluded.updated_at`
    ).run(workspaceId, providerKey, enabled ? 1 : 0, model || '', now);
  }
}
