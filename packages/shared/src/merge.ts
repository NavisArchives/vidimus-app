import { foldText } from './text.js';
import type {
  FindingCategory,
  ProviderKey,
  ProviderMode,
  ProviderOpinion,
  Severity,
} from './types.js';

export interface CandidateFinding {
  page: number;
  severity: Severity;
  category: FindingCategory;
  title: string;
  quote: string;
  sourceQuote?: string | null;
  suggestion: string;
  explanation: string;
  providerKey: ProviderKey;
  model: string;
  mode: ProviderMode;
  promptVersion: string;
  createdAt: string;
}

export interface ConsolidatedFinding {
  page: number;
  severity: Severity;
  category: FindingCategory;
  title: string;
  quote: string;
  sourceQuote: string | null;
  suggestion: string;
  explanation: string;
  providers: ProviderKey[];
  opinions: ProviderOpinion[];
  disagreement: boolean;
}

const SEV_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

function quotesOverlap(a: string, b: string): boolean {
  const fa = foldText(a);
  const fb = foldText(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  if (fa.length >= 10 && fb.length >= 10) {
    return fa.includes(fb) || fb.includes(fa);
  }
  return false;
}

/**
 * Consolidates raw candidate findings from multiple providers:
 * - Drops no-op findings where suggestion equals quote.
 * - Merges duplicate or overlapping findings on the same page.
 * - Escalates severity to the highest flagged level across providers.
 * - Preserves every provider's wording as an opinion and flags genuine disagreement.
 */
export function consolidateFindings(candidates: CandidateFinding[]): ConsolidatedFinding[] {
  const valid = candidates.filter((c) => {
    const q = c.quote.trim();
    const s = c.suggestion.trim();
    return q.length >= 3 && s.length > 0 && foldText(q) !== foldText(s);
  });

  const groups: ConsolidatedFinding[] = [];

  for (const c of valid) {
    const opinion: ProviderOpinion = {
      providerKey: c.providerKey,
      model: c.model,
      mode: c.mode,
      suggestion: c.suggestion.trim(),
      explanation: c.explanation.trim(),
      severity: c.severity,
      category: c.category,
      promptVersion: c.promptVersion,
      createdAt: c.createdAt,
    };

    const existing = groups.find(
      (g) => g.page === c.page && quotesOverlap(g.quote, c.quote)
    );

    if (!existing) {
      groups.push({
        page: c.page,
        severity: c.severity,
        category: c.category,
        title: c.title.trim(),
        quote: c.quote.trim(),
        sourceQuote: c.sourceQuote ? c.sourceQuote.trim() : null,
        suggestion: c.suggestion.trim(),
        explanation: c.explanation.trim(),
        providers: [c.providerKey],
        opinions: [opinion],
        disagreement: false,
      });
      continue;
    }

    // Avoid exact duplicate from the same provider
    const sameProvider = existing.opinions.find(
      (o) => o.providerKey === c.providerKey && foldText(o.suggestion) === foldText(c.suggestion)
    );
    if (sameProvider) continue;

    if (!existing.providers.includes(c.providerKey)) {
      existing.providers.push(c.providerKey);
    }
    existing.opinions.push(opinion);

    // Keep the most urgent severity
    if (SEV_RANK[c.severity] > SEV_RANK[existing.severity]) {
      existing.severity = c.severity;
    }

    // Prefer the more specific / fuller quote if one contains the other and matches
    if (c.sourceQuote && !existing.sourceQuote) {
      existing.sourceQuote = c.sourceQuote.trim();
    }

    // Detect disagreement when two providers propose meaningfully different suggestions
    const uniqueSuggestions = new Set(existing.opinions.map((o) => foldText(o.suggestion)));
    existing.disagreement = uniqueSuggestions.size > 1;
  }

  return groups.sort((a, b) => a.page - b.page || SEV_RANK[b.severity] - SEV_RANK[a.severity]);
}
