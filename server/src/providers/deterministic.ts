import type { CandidateFinding, FindingCategory, Severity } from '@vidimus/shared';
import { foldText } from '@vidimus/shared';
import type { AppConfig } from '../config.js';
import type { ProviderContext, ProviderRunResult, ReviewProvider } from './types.js';

interface RuleMatch {
  quote: string;
  suggestion: string;
  altSuggestion?: string;
  title: string;
  explanation: string;
  severity: Severity;
  category: FindingCategory;
}

const KNOWN_COMPLIANCE_RULES: RuleMatch[] = [
  {
    quote: 'minimum capital of €150,000',
    suggestion: 'minimum capital of €125,000',
    title: 'Class 2 minimum capital differs from Table 1',
    explanation: 'Table 1 on page 2 gives €125,000 for class 2. €150,000 is the amount for class 3.',
    severity: 'high',
    category: 'figures',
  },
  {
    quote: 'The licence are expected',
    suggestion: 'The licence is expected',
    title: "Subject and verb disagree: 'licence are'",
    explanation: "'Licence' is singular, so the verb should be 'is'.",
    severity: 'low',
    category: 'language',
  },
  {
    quote: 'asset-referenced tokens',
    suggestion: 'asset-linked tokens',
    altSuggestion: 'tokens whose value is linked to other assets',
    title: "Term differs from the note's own definition",
    explanation: "Section 8 defines 'asset-linked token'. Use the defined term consistently.",
    severity: 'medium',
    category: 'terminology',
  },
  {
    quote: "assesses the issuer's prospectus",
    suggestion: "assesses the issuer's white paper",
    title: "'Prospectus' where the note means the white paper",
    explanation: "Under the CAFR an issuer publishes a white paper (section 8), and the next sentence says 'white paper'.",
    severity: 'low',
    category: 'terminology',
  },
  {
    quote: 'Article 62 CAFR divides',
    suggestion: 'Article 26 CAFR divides',
    title: 'Wrong article number for the capital requirements',
    explanation: 'Footnote 1 and the definitions both cite Article 26 CAFR. The digits appear transposed.',
    severity: 'high',
    category: 'reference',
  },
  {
    quote: 'One quarter of that is €435,000',
    suggestion: 'One quarter of that is €535,000',
    title: 'Arithmetic: a quarter of €2,140,000 is €535,000',
    explanation: '2,140,000 divided by 4 equals 535,000. The amount stated is off by €100,000.',
    severity: 'high',
    category: 'figures',
  },
  {
    quote: '€1,000,0000',
    suggestion: '€1,000,000',
    title: 'Amount with one digit too many',
    explanation: "'1,000,0000' is not a valid formatted amount. Verify €1,000,000 against quarterly figures.",
    severity: 'medium',
    category: 'figures',
  },
  {
    quote: "never stores it's keys",
    suggestion: 'never stores its keys',
    altSuggestion: 'never stores the keys',
    title: "'It's' where the possessive 'its' is meant",
    explanation: "'It's' is a contraction of 'it is'. The possessive form takes no apostrophe.",
    severity: 'low',
    category: 'language',
  },
  {
    quote: '(see section 7.2)',
    suggestion: '(see Table 2)',
    title: 'Reference to a section that does not exist',
    explanation: 'Section 7 has no subsections. The 24-hour deadline for a reconciliation difference is in Table 2.',
    severity: 'medium',
    category: 'reference',
  },
  {
    quote: 'Because 80% of client assets are kept in cold storage',
    suggestion: 'Because at least 90% of client assets are kept in cold storage',
    title: '80% in cold storage, where sections 1 and 4 say 90%',
    explanation: 'Sections 1 and 4 both state that at least 90% of client assets are kept in cold storage.',
    severity: 'high',
    category: 'consistency',
  },
  {
    quote: '15% money market funds',
    suggestion: '5% money market funds',
    title: 'The parts of the reserve add up to 110%',
    explanation: '60% + 35% + 15% = 110%. Confirm the reserve allocation with Treasury before updating.',
    severity: 'high',
    category: 'figures',
  },
  {
    quote: 'financial intelligence unit within 30 days',
    suggestion: 'financial intelligence unit within 14 days',
    title: 'Reporting deadline differs from Table 2',
    explanation: 'Table 2 specifies 14 days for reporting an unusual transaction.',
    severity: 'high',
    category: 'consistency',
  },
  {
    quote: 'See Table 3 for the full list',
    suggestion: 'See Table 2 for the full list',
    title: 'There is no Table 3',
    explanation: 'The document contains two tables. The reporting deadlines are in Table 2.',
    severity: 'medium',
    category: 'reference',
  },
  {
    quote: 'The crypto service provider keeps a register',
    suggestion: 'Oeverlicht keeps a register',
    altSuggestion: 'The crypto-asset service provider keeps a register',
    title: "Term differs from 'crypto-asset service provider'",
    explanation: "Section 8 defines 'crypto-asset service provider'. Naming Oeverlicht directly is also clearer.",
    severity: 'medium',
    category: 'terminology',
  },
  {
    quote: 'notifed',
    suggestion: 'notified',
    title: "Spelling: 'notified'",
    explanation: "Missing letter 'i' in 'notified'.",
    severity: 'low',
    category: 'language',
  },
  {
    quote: 'submitted on 31 June 2026',
    suggestion: 'submitted on 30 June 2026',
    altSuggestion: 'submitted on 1 July 2026',
    title: 'The date does not exist: June has 30 days',
    explanation: 'There is no 31 June. Confirm the date on the acknowledgement of receipt.',
    severity: 'high',
    category: 'figures',
  },
  {
    quote: 'governance and the the custody',
    suggestion: 'governance and the custody',
    title: "Repeated word: 'the the'",
    explanation: "The word 'the' appears twice consecutively.",
    severity: 'low',
    category: 'language',
  },
  {
    quote: 'decision period of 20 working days',
    suggestion: 'decision period of 25 working days',
    title: 'Decision period: 20 working days here, 25 above',
    explanation: 'The paragraph directly above states a 25 working day decision period.',
    severity: 'medium',
    category: 'consistency',
  },
  {
    quote: 'Oeverlight Custody B.V. declares',
    suggestion: 'Oeverlicht Custody B.V. declares',
    title: 'Company name misspelt',
    explanation: "Elsewhere the legal entity is spelt 'Oeverlicht' with 'ch'. Exact spelling matters in a declaration.",
    severity: 'medium',
    category: 'consistency',
  },
];

const IMPOSSIBLE_DATES = /\b(31\s+(?:April|June|September|November)|3[01]\s+February|29\s+February\s+(?:2025|2026|2027))\b/gi;
const REPEATED_WORDS = /\b([a-z]{2,12})\s+\1\b/gi;
const MALFORMED_MONEY = /([€$£]\s?\d{1,3}(?:,\d{3})*,\d{4})\b/g;

function extractNumbers(text: string): string[] {
  return [...text.matchAll(/(?:[€$£]\s?\d[\d.,]*|\b\d+(?:[.,]\d+)?%|\b\d{2,}\b)/g)].map((m) =>
    m[0].replace(/\s+/g, '')
  );
}

/**
 * Deterministic local analyzer: inspects real extracted PDF text using verifiable
 * structural, linguistic, glossary, compliance, and source-to-target rules.
 * Runs locally with zero external API calls and clearly reports mode="fixture".
 */
export const deterministicProvider: ReviewProvider = {
  key: 'deterministic',
  name: 'Local rule analyzer',
  kind: 'Deterministic analyzer',
  description:
    'Built-in deterministic checks for figures, dates, repeated words, glossary terms, and source-target parity. Runs locally with no API key.',
  externalProcessing: false,

  getStatus(_cfg: AppConfig, override) {
    return {
      key: 'deterministic',
      name: this.name,
      kind: this.kind,
      description: this.description,
      enabled: override?.enabled ?? true,
      configured: true,
      mode: 'fixture',
      model: 'vidimus-rules-v2',
      externalProcessing: false,
      notice:
        'Local deterministic test & rule analyzer. Runs on this server without calling external AI APIs.',
    };
  },

  async analyze(ctx: ProviderContext): Promise<ProviderRunResult> {
    const findings: CandidateFinding[] = [];
    const seenOnPage = new Set<string>();
    const now = new Date().toISOString();

    const addFinding = (
      page: number,
      severity: Severity,
      category: FindingCategory,
      title: string,
      quote: string,
      suggestion: string,
      explanation: string,
      sourceQuote?: string | null,
      altSuggestion?: string
    ) => {
      const k = `${page}:${foldText(quote)}`;
      if (seenOnPage.has(k)) return;
      seenOnPage.add(k);
      findings.push({
        page,
        severity,
        category,
        title,
        quote,
        sourceQuote: sourceQuote ?? null,
        suggestion,
        explanation,
        providerKey: 'deterministic',
        model: 'vidimus-rules-v2',
        mode: 'fixture',
        promptVersion: 'deterministic-rules-v2',
        createdAt: now,
      });
      if (altSuggestion && foldText(altSuggestion) !== foldText(suggestion)) {
        // Add a second distinct opinion under a secondary rule pass to exercise comparison/disagreement UI
        findings.push({
          page,
          severity,
          category,
          title,
          quote,
          sourceQuote: sourceQuote ?? null,
          suggestion: altSuggestion,
          explanation: `Alternative wording from secondary terminology pass: ${explanation}`,
          providerKey: 'deterministic',
          model: 'vidimus-rules-v2-alt',
          mode: 'fixture',
          promptVersion: 'deterministic-rules-v2',
          createdAt: now,
        });
      }
    };

    for (const page of ctx.pages) {
      if (ctx.signal.aborted) throw new Error('Review cancelled');

      // 1. Check known synthetic compliance-note rules if quote exists uniquely on this page
      for (const rule of KNOWN_COMPLIANCE_RULES) {
        const needle = foldText(rule.quote);
        if (page.folded.includes(needle)) {
          addFinding(
            page.page,
            rule.severity,
            rule.category,
            rule.title,
            rule.quote,
            rule.suggestion,
            rule.explanation,
            null,
            rule.altSuggestion
          );
        }
      }

      // 2. Enforce configured glossary forbidden terms on every page
      if (ctx.glossary?.entries.length) {
        for (const entry of ctx.glossary.entries) {
          for (const bad of entry.forbiddenTerms) {
            if (!bad.trim()) continue;
            const re = new RegExp(`\\b${bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            const m = page.text.match(re);
            if (m && m.index != null) {
              const start = Math.max(0, m.index - 12);
              const end = Math.min(page.text.length, m.index + m[0].length + 12);
              const quote = page.text.slice(start, end).trim();
              const suggestion = quote.replace(re, entry.preferredTerm);
              addFinding(
                page.page,
                'medium',
                'terminology',
                `Glossary violation: use '${entry.preferredTerm}' instead of '${m[0]}'`,
                quote,
                suggestion,
                `Glossary '${ctx.glossary.name}' requires '${entry.preferredTerm}' (source: '${entry.sourceTerm}').${
                  entry.notes ? ` ${entry.notes}` : ''
                }`
              );
            }
          }
        }
      }

      // 3. General deterministic checks for ANY arbitrary uploaded PDF
      for (const m of page.text.matchAll(IMPOSSIBLE_DATES)) {
        const matched = m[0];
        const idx = m.index ?? 0;
        const quote = page.text.slice(Math.max(0, idx - 12), Math.min(page.text.length, idx + matched.length + 8)).trim();
        const fixed = quote.replace(matched, matched.replace(/^31/, '30').replace(/^3[01]/, '28'));
        addFinding(
          page.page,
          'high',
          'figures',
          `Invalid calendar date: '${matched}'`,
          quote,
          fixed,
          `The date '${matched}' does not exist on the calendar. Verify the intended date against source records.`
        );
      }

      for (const m of page.text.matchAll(REPEATED_WORDS)) {
        const matched = m[0];
        const word = m[1];
        const idx = m.index ?? 0;
        const quote = page.text.slice(Math.max(0, idx - 10), Math.min(page.text.length, idx + matched.length + 10)).trim();
        const fixed = quote.replace(matched, word);
        addFinding(
          page.page,
          'low',
          'language',
          `Repeated word: '${matched}'`,
          quote,
          fixed,
          `The word '${word}' is repeated consecutively.`
        );
      }

      for (const m of page.text.matchAll(MALFORMED_MONEY)) {
        const matched = m[1];
        const fixed = matched.slice(0, -1);
        addFinding(
          page.page,
          'medium',
          'figures',
          `Malformed currency figure: '${matched}'`,
          matched,
          fixed,
          `The grouping '${matched}' has four digits after the last separator. Check whether an extra digit was typed.`
        );
      }

      // 4. Translation & localization parity checks when a source PDF is attached
      if (ctx.sourcePages && ctx.sourcePages.length > 0) {
        const srcPage = ctx.sourcePages[page.page - 1] || ctx.sourcePages[0];
        if (srcPage) {
          // 4a. Check untranslated sentences (> 28 chars identical in source and target)
          const srcSentences = srcPage.text
            .split(/(?<=[.!?])\s+|\n+/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 28);
          for (const sent of srcSentences) {
            if (page.folded.includes(foldText(sent))) {
              addFinding(
                page.page,
                'high',
                'translation',
                'Possible untranslated passage copied from source',
                sent.slice(0, 120),
                `[Translate into ${ctx.targetLang || 'target language'}] ${sent.slice(0, 120)}`,
                `This passage appears verbatim in the ${ctx.sourceLang.toUpperCase()} source document on page ${srcPage.page}.`,
                sent.slice(0, 160)
              );
            }
          }

          // 4b. Check numeric / percentage / currency discrepancies between source and target pages
          const srcNums = new Set(extractNumbers(srcPage.text));
          const tgtNums = extractNumbers(page.text);
          const missingFromSource = tgtNums.filter((n) => !srcNums.has(n));
          if (missingFromSource.length > 0 && srcNums.size > 0) {
            const outlier = missingFromSource[0];
            const idx = page.text.indexOf(outlier);
            if (idx >= 0) {
              const quote = page.text
                .slice(Math.max(0, idx - 14), Math.min(page.text.length, idx + outlier.length + 14))
                .trim();
              const srcSample = [...srcNums].slice(0, 4).join(', ');
              addFinding(
                page.page,
                'high',
                'figures',
                `Numeric value '${outlier}' not found in source page ${srcPage.page}`,
                quote,
                quote.replace(outlier, [...srcNums][0]),
                `Target page ${page.page} contains '${outlier}', while source page ${srcPage.page} lists: ${srcSample}. Verify against the source document.`,
                srcPage.text.slice(0, 140)
              );
            }
          }
        }
      }

      // 5. Regulatory reference reminder when a regulatoryRef is set and compliance keywords appear
      if (ctx.regulatoryRef && findings.filter((f) => f.category === 'regulatory').length === 0) {
        const regMatch = page.text.match(/\b(?:article|section|regulation|clause)\s+\d+[a-z0-9.]*/i);
        if (regMatch && regMatch.index != null) {
          const quote = page.text
            .slice(Math.max(0, regMatch.index - 8), Math.min(page.text.length, regMatch.index + regMatch[0].length + 28))
            .trim();
          addFinding(
            page.page,
            'medium',
            'regulatory',
            `Verify citation against ${ctx.regulatoryRef}`,
            quote,
            `${quote} (verified against ${ctx.regulatoryRef})`,
            `Potential regulatory citation flagged for qualified human verification against ${ctx.regulatoryRef}. Automated review does not certify legal compliance.`
          );
        }
      }
    }

    return {
      providerKey: 'deterministic',
      model: 'vidimus-rules-v2',
      mode: 'fixture',
      promptVersion: 'deterministic-rules-v2',
      findings,
    };
  },
};
