# Vidimus Architecture

Vidimus is a full-stack, local-first document review application built with a strict separation between automated analysis and human decision-making: **machines analyze; humans decide**.

## System Overview

```text
+----------------------------------+        HTTPS / Cookie + CSRF        +--------------------------------------+
|  web/  (React 19 + TS + Vite)    | <---------------------------------> |  server/  (Fastify 5 + TS)           |
|  - Paper design system           |                                     |  - Auth, sessions, RBAC, CSRF        |
|  - PDF.js canvas + highlights    |                                     |  - Multipart PDF upload & validation |
|  - Floating findings lane        |                                     |  - PDF.js text/coord extraction      |
|  - Side-by-side translation view |                                     |  - Review orchestrator & job queue   |
|  - Dashboard, glossaries, export |                                     |  - Provider adapters (live + local)  |
+----------------------------------+                                     |  - CSV / MD / JSON / PDF exports     |
                 |                                                       +------------------+-------------------+
                 |                                                                          |
                 +----------------------> packages/shared/ <--------------------------------+
                                         (types, Zod schemas,                               |
                                          text folding, diffing,                            v
                                          consolidation/merge)           +--------------------------------------+
                                                                         |  SQLite (node:sqlite, WAL mode)      |
                                                                         |  + Private local file storage        |
                                                                         +--------------------------------------+
```

## Workspaces

### `packages/shared/` (`@vidimus/shared`)
Shared TypeScript contracts and pure domain logic reused identically across server and browser:
- **Types (`types.ts`):** Users, workspaces, documents, document versions, glossaries, providers, reviews, analysis runs, findings, anchor evidence, decisions, comments, audit events, summaries, and dashboard payloads.
- **Validation (`schemas.ts`):** Zod schemas for all API inputs and untrusted provider JSON responses.
- **Text folding & anchoring (`text.ts`):** NFKC normalization, typographic quote straightening, whitespace-stripped matching (`matchQuoteInFoldedText`), and word-level LCS diffing (`wordDiff`).
- **Consolidation (`merge.ts`):** Deduplicates overlapping findings across providers, escalates severity to the most urgent level, preserves alternative proposals as distinct opinions, and flags genuine provider disagreement.

### `server/` (`@vidimus/server`)
- **Database (`src/db/`):** Persistent SQLite database using Node 22 built-in `node:sqlite` (`DatabaseSync`) with `PRAGMA foreign_keys = ON`, WAL mode, and versioned transactional migrations (`migrations.ts`).
- **Security & Auth (`src/security/`, `src/middleware/`):**
  - Per-user salted `scrypt` password hashes verified with `crypto.timingSafeEqual`.
  - Opaque session tokens stored as SHA-256 hashes in `sessions`, delivered via `HttpOnly; SameSite=Lax` cookies.
  - Per-session CSRF token validated via `X-CSRF-Token` on all mutating `/api/*` requests.
  - Server-side RBAC (`admin`, `reviewer`, `viewer`) and workspace scoping enforced on every protected endpoint.
  - Security headers (`@fastify/helmet` CSP, nosniff, frame-ancestors none) and request rate limiting (`@fastify/rate-limit`).
- **Document Ingestion & PDF Anchoring (`src/services/pdf.ts`):**
  - Validates `%PDF-` signature, maximum file size (default 25 MB), and safe UUID filenames (preventing path traversal).
  - Extracts page count, page dimensions, metadata, and per-item text coordinates via `pdfjs-dist` legacy build.
  - Flags scanned / image-only PDFs with insufficient extractable text as `ocr_required` instead of silently producing empty reviews.
  - Maps quoted findings strictly to page-relative bounding boxes (`exact`, `ambiguous`, or `unresolved`). Never anchors missing or ambiguous passages to an unrelated sentence.
- **Provider Adapters (`src/providers/`):**
  - Clean `ReviewProvider` interface for Anthropic Claude (`@anthropic-ai/sdk`), OpenAI (`openai`), Google Gemini (`@google/genai`), LanguageTool (HTTP `/v2/check`), and the built-in local deterministic rule analyzer (`deterministic`).
  - Prompt-injection safeguards isolate untrusted document text inside `<untrusted_document>` tags and validate every model output against strict Zod schemas.
  - Credentials live exclusively in server environment variables and are never returned to the frontend.
- **Background Orchestrator (`src/services/orchestrator.ts`):**
  - Concurrency-limited job queue with per-review `AbortController` cancellation and startup crash recovery (`recoverInterruptedReviews`).
  - Runs selected providers via `Promise.allSettled` so a single provider failure records an isolated error in `analysis_runs` while surviving providers complete (`completed_with_errors`).
- **Exports (`src/services/exports.ts`):**
  - Generates CSV, Markdown, JSON, and pure-TypeScript PDF reports (`pdf-lib`) directly from persisted database state, separating unapproved automated suggestions from human-approved corrections.

### `web/` (`@vidimus/web`)
- Built with React 19, TypeScript, React Router 7, Vite 6, and `pdfjs-dist`.
- Preserves the **Paper** design system (`src/styles/paper.css`): cool-neutral `#F1F1F2` canvas, crisp `#FFFFFF` floating cards, Geist typography, emerald `#047857` reserved strictly for approval, translucent severity-tinted PDF highlights with numbered corner badges, Google Docs-style floating findings lane on desktop, and full-width PDF + hugging peek bar + full-page Findings screen on phones (`<= 760px`).
- Supports light and dark themes, keyboard-first review (`j`/`k`, `a`, `x`, `e`, `/`, `Esc`), and side-by-side source + target viewing for translation pairs.

## Preserved Legacy Assets

The original static Paper lab (`lab/`), multilingual site-scraping translation pipeline (`pipeline/`, `desk/`, `sample/`, `out/`), and their original Python tests (`tests/`) remain preserved intact in the repository.
