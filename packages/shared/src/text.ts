import type { AnchorStatus } from './types.js';

/**
 * Fold text identically to Vidimus's original comparison:
 * NFKC normalization, typographic quotes straightened, whitespace stripped, lowercased.
 */
export function foldText(input: string): string {
  return String(input || '')
    .normalize('NFKC')
    .replace(/[\u2019\u2018\u02bc]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function foldChar(ch: string): string {
  return ch
    .normalize('NFKC')
    .replace(/[\u2019\u2018\u02bc]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .toLowerCase();
}

export function normalizeSpaces(input: string): string {
  return String(input || '')
    .normalize('NFKC')
    .replace(/[\u2019\u2018\u02bc]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FoldMatchResult {
  status: AnchorStatus;
  occurrenceCount: number;
  startIndex: number;
  endIndex: number;
}

/**
 * Strictly verify that a quoted passage appears in the folded page text.
 * Never guesses when missing (0 matches) or ambiguous (>1 matches).
 */
export function matchQuoteInFoldedText(pageFolded: string, quote: string): FoldMatchResult {
  const needle = foldText(quote);
  if (needle.length < 3) {
    return { status: 'unresolved', occurrenceCount: 0, startIndex: -1, endIndex: -1 };
  }
  let count = 0;
  let first = -1;
  let pos = 0;
  while (pos <= pageFolded.length - needle.length) {
    const idx = pageFolded.indexOf(needle, pos);
    if (idx === -1) break;
    if (first === -1) first = idx;
    count += 1;
    pos = idx + 1;
  }
  if (count === 0) {
    return { status: 'unresolved', occurrenceCount: 0, startIndex: -1, endIndex: -1 };
  }
  if (count > 1) {
    return {
      status: 'ambiguous',
      occurrenceCount: count,
      startIndex: first,
      endIndex: first + needle.length,
    };
  }
  return {
    status: 'exact',
    occurrenceCount: 1,
    startIndex: first,
    endIndex: first + needle.length,
  };
}

export type DiffPart = { op: '=' | '+' | '-'; text: string };

function tokenize(s: string): string[] {
  return String(s || '')
    .split(/(\s+)/)
    .filter((x) => x !== '');
}

/**
 * Word-level LCS diff used to highlight only the changed words in green
 * (preserving Paper's "new wording with changes in green" design).
 */
export function wordDiff(original: string, suggested: string): DiffPart[] {
  const A = tokenize(original);
  const B = tokenize(suggested);
  const n = A.length;
  const m = B.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ op: '=', text: A[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) {
      out.push({ op: '-', text: A[i++] });
    } else {
      out.push({ op: '+', text: B[j++] });
    }
  }
  while (i < n) out.push({ op: '-', text: A[i++] });
  while (j < m) out.push({ op: '+', text: B[j++] });
  return out;
}
