import { z } from 'zod';

export const roleSchema = z.enum(['admin', 'reviewer', 'viewer']);
export const severitySchema = z.enum(['high', 'medium', 'low']);
export const categorySchema = z.enum([
  'figures',
  'reference',
  'terminology',
  'consistency',
  'language',
  'translation',
  'omission',
  'formatting',
  'regulatory',
]);
export const providerKeySchema = z.enum([
  'anthropic',
  'openai',
  'gemini',
  'languagetool',
  'deterministic',
]);
export const reviewTypeSchema = z.enum([
  'regulatory',
  'translation',
  'terminology',
  'editorial',
  'consistency',
  'comprehensive',
]);
export const verdictSchema = z.enum(['approved', 'rejected', 'deferred', 'reopened']);
export const exportFormatSchema = z.enum(['csv', 'md', 'json', 'pdf']);

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(6).max(200),
});

export const registerSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(2).max(120),
  title: z.string().max(120).optional().default('Reviewer'),
  password: z.string().min(8).max(200),
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(120),
});

export const createReviewSchema = z.object({
  documentId: z.string().min(1),
  documentVersionId: z.string().optional(),
  sourceVersionId: z.string().nullable().optional(),
  reviewType: reviewTypeSchema.default('regulatory'),
  checks: z.array(z.string()).min(1).default(['figures', 'reference', 'terminology', 'consistency', 'language']),
  providers: z.array(providerKeySchema).min(1).default(['deterministic']),
  depth: z.enum(['quick', 'standard', 'thorough']).default('standard'),
  sourceLang: z.string().min(2).max(16).default('en'),
  targetLang: z.string().max(16).nullable().optional(),
  instructions: z.string().max(4000).optional().default(''),
  glossaryId: z.string().nullable().optional(),
  regulatoryRef: z.string().max(500).nullable().optional(),
});

export const decisionSchema = z.object({
  verdict: verdictSchema,
  note: z.string().max(2000).optional(),
});

export const editSuggestionSchema = z.object({
  suggestion: z.string().min(1).max(4000),
});

export const commentSchema = z.object({
  body: z.string().min(1).max(4000),
});

export const glossaryEntrySchema = z.object({
  sourceTerm: z.string().min(1).max(200),
  preferredTerm: z.string().min(1).max(200),
  forbiddenTerms: z.array(z.string().min(1).max(200)).default([]),
  notes: z.string().max(1000).optional().default(''),
});

export const createGlossarySchema = z.object({
  name: z.string().min(2).max(150),
  sourceLang: z.string().min(2).max(16).default('en'),
  targetLang: z.string().min(2).max(16).default('en'),
  entries: z.array(glossaryEntrySchema).min(1),
});

export const updateProviderSchema = z.object({
  enabled: z.boolean(),
  model: z.string().min(1).max(120).optional(),
});

/**
 * Untrusted AI model output validation schema.
 * Any malformed or out-of-range fields are rejected cleanly.
 */
export const rawProviderFindingSchema = z.object({
  page: z.number().int().min(1),
  severity: severitySchema,
  category: categorySchema,
  title: z.string().min(3).max(240),
  quote: z.string().min(3).max(2000),
  sourceQuote: z.string().max(2000).nullable().optional(),
  suggestion: z.string().min(1).max(2000),
  explanation: z.string().min(3).max(3000),
});

export const rawProviderResponseSchema = z.object({
  findings: z.array(rawProviderFindingSchema).max(200),
});
