export type Role = 'admin' | 'reviewer' | 'viewer';

export type Severity = 'high' | 'medium' | 'low';

export type FindingCategory =
  | 'figures'
  | 'reference'
  | 'terminology'
  | 'consistency'
  | 'language'
  | 'translation'
  | 'omission'
  | 'formatting'
  | 'regulatory';

export type FindingStatus = 'open' | 'approved' | 'rejected' | 'deferred' | 'split';

export type DecisionVerdict = 'approved' | 'rejected' | 'deferred' | 'reopened';

export type AnchorStatus = 'exact' | 'ambiguous' | 'unresolved';

export type ProviderKey =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'languagetool'
  | 'deterministic';

export type ProviderMode = 'live' | 'fixture' | 'unconfigured';

export type ReviewType =
  | 'regulatory'
  | 'translation'
  | 'terminology'
  | 'editorial'
  | 'consistency'
  | 'comprehensive';

export type ReviewStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

export type ExtractionStatus = 'ready' | 'ocr_required' | 'failed';

export type DocumentKind = 'single' | 'translation';

export type ExportFormat = 'csv' | 'md' | 'json' | 'pdf';

export interface AnchorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnchorEvidence {
  page: number;
  startOffset: number;
  endOffset: number;
  occurrenceCount: number;
  rects: AnchorRect[];
  sourcePage?: number;
  sourceQuote?: string;
  alignmentConfidence?: 'exact' | 'approximate' | 'uncertain';
}

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: Role;
  title: string;
  avatarIndex: number;
}

export interface WorkspaceDTO {
  id: string;
  slug: string;
  name: string;
  role: Role;
}

export interface DocumentVersionDTO {
  id: string;
  documentId: string;
  role: 'primary' | 'source' | 'target';
  versionNumber: number;
  originalFilename: string;
  sizeBytes: number;
  pageCount: number;
  extractionStatus: ExtractionStatus;
  sha256: string;
  uploadedBy: string;
  uploadedByName?: string;
  createdAt: string;
}

export interface DocumentDTO {
  id: string;
  workspaceId: string;
  title: string;
  subtitle: string;
  kind: DocumentKind;
  sourceLang: string;
  targetLang: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestVersion: DocumentVersionDTO | null;
  sourceVersion: DocumentVersionDTO | null;
  versions?: DocumentVersionDTO[];
  latestReviewId?: string | null;
  latestReviewStatus?: ReviewStatus | null;
  findingsCount?: number;
  decidedCount?: number;
}

export interface GlossaryEntry {
  sourceTerm: string;
  preferredTerm: string;
  forbiddenTerms: string[];
  notes?: string;
}

export interface GlossaryDTO {
  id: string;
  workspaceId: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  entries: GlossaryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ProviderStatusDTO {
  key: ProviderKey;
  name: string;
  kind: 'AI model' | 'Language check' | 'Deterministic analyzer';
  description: string;
  enabled: boolean;
  configured: boolean;
  mode: ProviderMode;
  model: string;
  externalProcessing: boolean;
  notice: string;
}

export interface AnalysisRunDTO {
  id: string;
  reviewId: string;
  providerKey: ProviderKey;
  model: string;
  promptVersion: string;
  mode: ProviderMode;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  findingsCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ReviewConfig {
  checks: string[];
  providers: ProviderKey[];
  depth: 'quick' | 'standard' | 'thorough';
  sourceLang: string;
  targetLang?: string | null;
  instructions?: string;
  glossaryId?: string | null;
  regulatoryRef?: string | null;
}

export interface ReviewDTO {
  id: string;
  workspaceId: string;
  documentId: string;
  documentTitle?: string;
  documentSubtitle?: string;
  documentKind?: DocumentKind;
  documentVersionId: string;
  sourceVersionId: string | null;
  pageCount?: number;
  reviewType: ReviewType;
  config: ReviewConfig;
  status: ReviewStatus;
  progressPct: number;
  currentStage: string;
  errorMessage: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  runs?: AnalysisRunDTO[];
  counts?: {
    total: number;
    open: number;
    approved: number;
    rejected: number;
    deferred: number;
    split: number;
    high: number;
    medium: number;
    low: number;
  };
}

export interface ProviderOpinion {
  providerKey: ProviderKey;
  model: string;
  mode: ProviderMode;
  suggestion: string;
  explanation: string;
  severity: Severity;
  category: FindingCategory;
  promptVersion: string;
  createdAt: string;
}

export interface DecisionDTO {
  id: string;
  findingId: string;
  userId: string;
  userName: string;
  userAvatarIndex: number;
  verdict: DecisionVerdict;
  note: string | null;
  createdAt: string;
}

export interface CommentDTO {
  id: string;
  findingId: string;
  userId: string;
  userName: string;
  userAvatarIndex: number;
  body: string;
  createdAt: string;
}

export interface FindingDTO {
  id: string;
  reviewId: string;
  documentVersionId: string;
  key: string;
  seq: number;
  page: number;
  severity: Severity;
  category: FindingCategory;
  title: string;
  quote: string;
  sourceQuote: string | null;
  suggestion: string;
  editedSuggestion: string | null;
  editedBy: string | null;
  editedByName: string | null;
  editedAt: string | null;
  explanation: string;
  anchorStatus: AnchorStatus;
  anchor: AnchorEvidence | null;
  providers: ProviderKey[];
  opinions: ProviderOpinion[];
  disagreement: boolean;
  status: FindingStatus;
  decisions: DecisionDTO[];
  activeDecisions: Record<string, DecisionDTO>;
  comments: CommentDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditEventDTO {
  id: string;
  workspaceId: string;
  actorId: string | null;
  actorName: string;
  actorAvatarIndex: number;
  entityType: string;
  entityId: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ReviewSummaryDTO {
  review: ReviewDTO;
  totals: {
    total: number;
    open: number;
    approved: number;
    rejected: number;
    deferred: number;
    split: number;
    unresolvedAnchors: number;
    providerAgreements: number;
    providerDisagreements: number;
  };
  bySeverity: Record<Severity, number>;
  byCategory: Record<string, number>;
  byProvider: Record<string, number>;
}

export interface DashboardDTO {
  workspace: WorkspaceDTO;
  metrics: {
    documentsCount: number;
    activeReviewsCount: number;
    completedReviewsCount: number;
    pendingDecisionsCount: number;
    highSeverityOpenCount: number;
    connectedProvidersCount: number;
    totalProvidersCount: number;
  };
  continueReview: ReviewDTO | null;
  attentionReviews: ReviewDTO[];
  recentDocuments: DocumentDTO[];
  recentActivity: AuditEventDTO[];
}
