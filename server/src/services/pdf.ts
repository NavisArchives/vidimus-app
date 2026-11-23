import fs from 'node:fs';
import path from 'node:path';
import type { AnchorEvidence, AnchorRect, AnchorStatus, ExtractionStatus } from '@vidimus/shared';
import { foldChar, foldText, matchQuoteInFoldedText } from '@vidimus/shared';
import { newId, sanitizeFilename, sha256Hex } from '../security/crypto.js';

export interface ExtractedTextItem {
  str: string;
  x: number;
  base: number;
  w: number;
  h: number;
}

export interface ExtractedPage {
  page: number;
  width: number;
  height: number;
  text: string;
  folded: string;
  items: ExtractedTextItem[];
}

export interface PdfExtractionResult {
  pageCount: number;
  extractionStatus: ExtractionStatus;
  pages: ExtractedPage[];
  metadata: Record<string, string>;
}

const PDF_MAGIC = Buffer.from('%PDF-');

export function validatePdfBuffer(buf: Buffer, maxBytes: number): { ok: true } | { ok: false; error: string } {
  if (!buf || buf.length === 0) {
    return { ok: false, error: 'Uploaded file is empty.' };
  }
  if (buf.length > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return { ok: false, error: `File exceeds the maximum allowed size of ${maxMb} MB.` };
  }
  const head = buf.subarray(0, 1024);
  if (head.indexOf(PDF_MAGIC) === -1) {
    return { ok: false, error: 'Invalid PDF file signature. Please upload a valid PDF document.' };
  }
  return { ok: true };
}

export function storeUploadedPdf(
  uploadsDir: string,
  originalFilename: string,
  buffer: Buffer
): { storedFilename: string; cleanFilename: string; sha256: string; sizeBytes: number } {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const cleanFilename = sanitizeFilename(originalFilename);
  const storedFilename = `${newId('pdf')}.pdf`;
  const targetPath = path.resolve(uploadsDir, storedFilename);
  if (!targetPath.startsWith(path.resolve(uploadsDir) + path.sep)) {
    throw new Error('Unsafe storage path');
  }
  fs.writeFileSync(targetPath, buffer, { mode: 0o600 });
  return {
    storedFilename,
    cleanFilename,
    sha256: sha256Hex(buffer),
    sizeBytes: buffer.length,
  };
}

export function resolveStoredPdfPath(uploadsDir: string, storedFilename: string): string {
  if (!/^[a-zA-Z0-9_.-]+\.pdf$/.test(storedFilename)) {
    throw new Error('Invalid stored filename');
  }
  const root = path.resolve(uploadsDir);
  const full = path.resolve(root, storedFilename);
  if (!full.startsWith(root + path.sep)) {
    throw new Error('Path traversal rejected');
  }
  return full;
}

let pdfjsLibPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;
async function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLibPromise;
}

/**
 * Extracts per-page text and coordinates using PDF.js.
 * Detects scanned/image-only PDFs that lack extractable text and marks them ocr_required.
 */
export async function extractPdf(buffer: Buffer): Promise<PdfExtractionResult> {
  const pdfjs = await getPdfJs();
  // Copy into a fresh Uint8Array so PDF.js worker transfer never detaches the caller's Buffer
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });

  const doc = await loadingTask.promise;
  try {
    const pages: ExtractedPage[] = [];
    let totalChars = 0;

    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items: ExtractedTextItem[] = [];
      const textParts: string[] = [];

      for (const raw of tc.items) {
        if (!('str' in raw) || typeof raw.str !== 'string') continue;
        const tr = pdfjs.Util.transform(vp.transform, raw.transform);
        const h = Math.hypot(tr[2], tr[3]) || 10;
        const item: ExtractedTextItem = {
          str: raw.str,
          x: Number(tr[4].toFixed(2)),
          base: Number(tr[5].toFixed(2)),
          w: Number((raw.width || 0).toFixed(2)),
          h: Number(h.toFixed(2)),
        };
        items.push(item);
        textParts.push(raw.str);
        if ('hasEOL' in raw && raw.hasEOL) {
          textParts.push('\n');
        } else {
          textParts.push(' ');
        }
      }

      const text = textParts
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      const folded = foldText(text);
      totalChars += folded.length;

      pages.push({
        page: n,
        width: Number(vp.width.toFixed(2)),
        height: Number(vp.height.toFixed(2)),
        text,
        folded,
        items,
      });
    }

    const metaObj = await doc.getMetadata().catch(() => null);
    const info = (metaObj?.info || {}) as Record<string, unknown>;
    const metadata: Record<string, string> = {};
    for (const k of ['Title', 'Author', 'Subject', 'Creator', 'Producer']) {
      if (typeof info[k] === 'string' && info[k].trim()) {
        metadata[k.toLowerCase()] = info[k].trim().slice(0, 300);
      }
    }

    // Detect image-only / scanned PDFs (e.g. < 15 non-whitespace chars across the whole doc)
    const extractionStatus: ExtractionStatus = totalChars < 15 ? 'ocr_required' : 'ready';

    return {
      pageCount: doc.numPages,
      extractionStatus,
      pages,
      metadata,
    };
  } finally {
    await doc.destroy();
  }
}

/**
 * Anchors a quote strictly against extracted page text and computes page-relative
 * bounding boxes. Returns `exact` only if matched uniquely; never silently anchors
 * missing or ambiguous passages to an unrelated sentence.
 */
export function anchorQuoteToPage(
  page: ExtractedPage | undefined,
  quote: string
): { status: AnchorStatus; evidence: AnchorEvidence | null } {
  if (!page) {
    return { status: 'unresolved', evidence: null };
  }

  // Build character-level folded map over page items
  let folded = '';
  const map: Array<[number, number]> = [];
  page.items.forEach((it, itemIdx) => {
    const chars = [...it.str];
    chars.forEach((ch, off) => {
      if (/\s/.test(ch)) return;
      for (const c of foldChar(ch)) {
        folded += c;
        map.push([itemIdx, off]);
      }
    });
  });

  const match = matchQuoteInFoldedText(folded, quote);
  if (match.status === 'unresolved') {
    return {
      status: 'unresolved',
      evidence: {
        page: page.page,
        startOffset: -1,
        endOffset: -1,
        occurrenceCount: 0,
        rects: [],
      },
    };
  }

  if (match.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      evidence: {
        page: page.page,
        startOffset: match.startIndex,
        endOffset: match.endIndex,
        occurrenceCount: match.occurrenceCount,
        rects: [],
      },
    };
  }

  const [ia, oa] = map[match.startIndex];
  const [ib, ob] = map[match.endIndex - 1];
  const lines: Array<{ base: number; x0: number; x1: number; top: number; bot: number }> = [];

  for (let i = ia; i <= ib; i++) {
    const it = page.items[i];
    if (!it || !it.w) continue;
    const len = Math.max(1, [...it.str].length);
    const a = i === ia ? oa : 0;
    const b = i === ib ? ob + 1 : len;
    const x0 = it.x + (it.w * a) / len;
    const x1 = it.x + (it.w * b) / len;
    const top = it.base - it.h * 0.86;
    const bot = it.base + it.h * 0.24;
    const existingLine = lines.find((l) => Math.abs(l.base - it.base) < it.h * 0.5);
    if (existingLine) {
      existingLine.x0 = Math.min(existingLine.x0, x0);
      existingLine.x1 = Math.max(existingLine.x1, x1);
      existingLine.top = Math.min(existingLine.top, top);
      existingLine.bot = Math.max(existingLine.bot, bot);
    } else {
      lines.push({ base: it.base, x0, x1, top, bot });
    }
  }

  const rects: AnchorRect[] = lines.map((l) => ({
    x: Number(((l.x0 - 1.5) / page.width).toFixed(5)),
    y: Number(((l.top - 1) / page.height).toFixed(5)),
    w: Number(((l.x1 - l.x0 + 3) / page.width).toFixed(5)),
    h: Number(((l.bot - l.top + 2) / page.height).toFixed(5)),
  }));

  return {
    status: 'exact',
    evidence: {
      page: page.page,
      startOffset: match.startIndex,
      endOffset: match.endIndex,
      occurrenceCount: 1,
      rects,
    },
  };
}
