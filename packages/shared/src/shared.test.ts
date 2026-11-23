import { describe, expect, it } from 'vitest';
import {
  consolidateFindings,
  foldText,
  matchQuoteInFoldedText,
  rawProviderResponseSchema,
  wordDiff,
} from './index.js';

describe('text folding and strict quote matching', () => {
  it('normalizes whitespace, typographic quotes, and case', () => {
    expect(foldText('Oeverlicht’s “minimum capital”\n  of €150,000')).toBe(
      `oeverlicht's"minimumcapital"of€150,000`
    );
  });

  it('matches unique quotes exactly and refuses missing or ambiguous quotes', () => {
    const page = foldText('Class 2 requires minimum capital of €150,000. Also €150,000 appears here.');
    const exact = matchQuoteInFoldedText(page, 'minimum capital of €150,000');
    expect(exact.status).toBe('exact');
    expect(exact.occurrenceCount).toBe(1);

    const ambiguous = matchQuoteInFoldedText(page, '€150,000');
    expect(ambiguous.status).toBe('ambiguous');
    expect(ambiguous.occurrenceCount).toBe(2);

    const missing = matchQuoteInFoldedText(page, 'completely absent phrase');
    expect(missing.status).toBe('unresolved');
    expect(missing.occurrenceCount).toBe(0);
  });

  it('computes word diffs cleanly', () => {
    const parts = wordDiff('minimum capital of €150,000', 'minimum capital of €125,000');
    expect(parts.filter((p) => p.op === '+').map((p) => p.text)).toEqual(['€125,000']);
    expect(parts.filter((p) => p.op === '-').map((p) => p.text)).toEqual(['€150,000']);
  });
});

describe('multi-provider finding consolidation', () => {
  it('merges overlapping findings, escalates severity, and flags disagreements', () => {
    const now = new Date().toISOString();
    const merged = consolidateFindings([
      {
        page: 1,
        severity: 'medium',
        category: 'terminology',
        title: 'Wrong defined term',
        quote: 'asset-referenced tokens',
        suggestion: 'asset-linked tokens',
        explanation: 'Section 8 defines asset-linked token.',
        providerKey: 'anthropic',
        model: 'claude-test',
        mode: 'live',
        promptVersion: 'v2',
        createdAt: now,
      },
      {
        page: 1,
        severity: 'high',
        category: 'terminology',
        title: 'Defined term mismatch',
        quote: 'asset-referenced tokens',
        suggestion: 'tokens linked to other assets',
        explanation: 'Use clear wording.',
        providerKey: 'openai',
        model: 'gpt-test',
        mode: 'live',
        promptVersion: 'v2',
        createdAt: now,
      },
      {
        // No-op finding should be dropped
        page: 1,
        severity: 'low',
        category: 'language',
        title: 'No-op',
        quote: 'same text',
        suggestion: 'same text',
        explanation: 'Should be filtered out.',
        providerKey: 'gemini',
        model: 'gemini-test',
        mode: 'live',
        promptVersion: 'v2',
        createdAt: now,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].severity).toBe('high');
    expect(merged[0].providers).toEqual(['anthropic', 'openai']);
    expect(merged[0].opinions).toHaveLength(2);
    expect(merged[0].disagreement).toBe(true);
  });

  it('rejects malformed untrusted provider payloads', () => {
    const bad = rawProviderResponseSchema.safeParse({
      findings: [{ page: 0, severity: 'extreme', title: 'x' }],
    });
    expect(bad.success).toBe(false);
  });
});
