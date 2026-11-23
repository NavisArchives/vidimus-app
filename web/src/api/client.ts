import type {
  AuditEventDTO,
  DashboardDTO,
  DecisionVerdict,
  DocumentDTO,
  ExportFormat,
  FindingDTO,
  GlossaryDTO,
  GlossaryEntry,
  ProviderKey,
  ProviderStatusDTO,
  ReviewDTO,
  ReviewSummaryDTO,
  ReviewType,
  UserDTO,
  WorkspaceDTO,
} from '@vidimus/shared';

export interface SessionPayload {
  user: UserDTO;
  csrfToken: string;
  workspaces: WorkspaceDTO[];
  activeWorkspace: WorkspaceDTO;
}

export interface DevAccountsPayload {
  devMode: boolean;
  hintPassword: string;
  accounts: Array<{
    email: string;
    name: string;
    title: string;
    role: string;
    avatarIndex: number;
  }>;
}

let csrfToken = '';
let activeWorkspaceId = '';

export function setApiContext(csrf: string, workspaceId: string) {
  csrfToken = csrf;
  activeWorkspaceId = workspaceId;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  if (activeWorkspaceId) {
    headers.set('X-Workspace-Id', activeWorkspaceId);
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) msg = err.error;
    } catch {
      // ignore parse failure
    }
    throw new ApiError(res.status, msg);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return (await res.json()) as T;
  }
  return undefined as T;
}

export function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress?: (pct: number) => void
): Promise<{ document: DocumentDTO }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    if (activeWorkspaceId) xhr.setRequestHeader('X-Workspace-Id', activeWorkspaceId);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(json as { document: DocumentDTO });
        } else {
          reject(new ApiError(xhr.status, json.error || `Upload failed (${xhr.status})`));
        }
      } catch {
        reject(new ApiError(xhr.status, `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.send(formData);
  });
}

export const api = {
  // Auth
  me: () => request<SessionPayload>('/api/auth/me'),
  devAccounts: () => request<DevAccountsPayload>('/api/auth/dev-accounts'),
  login: (email: string, password: string) =>
    request<SessionPayload>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (payload: { email: string; name: string; title?: string; password: string }) =>
    request<SessionPayload>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Workspaces & Dashboard
  createWorkspace: (name: string) =>
    request<WorkspaceDTO>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  dashboard: () => request<DashboardDTO>('/api/dashboard'),
  audit: () => request<{ events: AuditEventDTO[] }>('/api/audit'),

  // Documents
  documents: (q?: string) =>
    request<{ documents: DocumentDTO[] }>(
      `/api/documents${q ? `?q=${encodeURIComponent(q)}` : ''}`
    ),
  document: (id: string) => request<{ document: DocumentDTO }>(`/api/documents/${id}`),
  documentPages: (id: string, versionId: string) =>
    request<{
      pages: Array<{ page: number; width: number; height: number; charCount: number; excerpt: string }>;
    }>(`/api/documents/${id}/versions/${versionId}/pages`),
  documentFileUrl: (id: string, versionId: string) =>
    `/api/documents/${id}/versions/${versionId}/file`,

  // Glossaries
  glossaries: () => request<{ glossaries: GlossaryDTO[] }>('/api/glossaries'),
  createGlossary: (payload: {
    name: string;
    sourceLang: string;
    targetLang: string;
    entries: GlossaryEntry[];
  }) =>
    request<{ glossary: GlossaryDTO }>('/api/glossaries', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateGlossary: (
    id: string,
    payload: { name: string; sourceLang: string; targetLang: string; entries: GlossaryEntry[] }
  ) =>
    request<{ glossary: GlossaryDTO }>(`/api/glossaries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteGlossary: (id: string) =>
    request<{ ok: boolean }>(`/api/glossaries/${id}`, { method: 'DELETE' }),

  // Providers
  providers: () => request<{ providers: ProviderStatusDTO[] }>('/api/providers'),
  updateProvider: (key: ProviderKey, payload: { enabled: boolean; model?: string }) =>
    request<{ providers: ProviderStatusDTO[] }>(`/api/providers/${key}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Reviews
  reviews: () => request<{ reviews: ReviewDTO[] }>('/api/reviews'),
  review: (id: string) => request<{ review: ReviewDTO }>(`/api/reviews/${id}`),
  createReview: (payload: {
    documentId: string;
    documentVersionId?: string;
    sourceVersionId?: string | null;
    reviewType: ReviewType;
    checks: string[];
    providers: ProviderKey[];
    depth: 'quick' | 'standard' | 'thorough';
    sourceLang: string;
    targetLang?: string | null;
    instructions?: string;
    glossaryId?: string | null;
    regulatoryRef?: string | null;
  }) =>
    request<{ review: ReviewDTO }>('/api/reviews', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  cancelReview: (id: string) =>
    request<{ cancelled: boolean; review: ReviewDTO }>(`/api/reviews/${id}/cancel`, {
      method: 'POST',
    }),
  reviewFindings: (id: string) =>
    request<{ review: ReviewDTO; findings: FindingDTO[] }>(`/api/reviews/${id}/findings`),
  reviewSummary: (id: string) => request<ReviewSummaryDTO>(`/api/reviews/${id}/summary`),
  exportUrl: (id: string, format: ExportFormat, scope: 'all' | 'approved') =>
    `/api/reviews/${id}/export?format=${format}&scope=${scope}`,

  // Finding Actions
  decideFinding: (id: string, verdict: DecisionVerdict, note?: string) =>
    request<{ finding: FindingDTO }>(`/api/findings/${id}/decisions`, {
      method: 'POST',
      body: JSON.stringify({ verdict, note }),
    }),
  editSuggestion: (id: string, suggestion: string) =>
    request<{ finding: FindingDTO }>(`/api/findings/${id}/suggestion`, {
      method: 'PATCH',
      body: JSON.stringify({ suggestion }),
    }),
  addComment: (id: string, body: string) =>
    request<{ finding: FindingDTO }>(`/api/findings/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
};
