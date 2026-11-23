import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { FindingDTO, ReviewDTO, ReviewSummaryDTO } from '@vidimus/shared';

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function decisionNames(f: FindingDTO, verdict: string): string {
  return Object.values(f.activeDecisions)
    .filter((d) => d.verdict === verdict)
    .map((d) => d.userName)
    .join(', ');
}

function finalWording(f: FindingDTO): string {
  return f.editedSuggestion || f.suggestion;
}

export function filterExportFindings(
  findings: FindingDTO[],
  scope: 'all' | 'approved'
): FindingDTO[] {
  return scope === 'approved' ? findings.filter((f) => f.status === 'approved') : findings;
}

export function generateCsvExport(findings: FindingDTO[]): string {
  const headers = [
    'Key',
    'Page',
    'Severity',
    'Category',
    'Anchor Status',
    'Title',
    'Current Text',
    'Source Text',
    'Tool Suggestion',
    'Human Edited Wording',
    'Human Approved Wording',
    'Edited By Human',
    'Status',
    'Approved By',
    'Rejected By',
    'Deferred By',
    'Providers',
    'Provider Disagreement',
    'Explanation',
    'Reviewer Comments',
  ];

  const rows = findings.map((f) =>
    [
      f.key,
      f.page,
      f.severity,
      f.category,
      f.anchorStatus,
      f.title,
      f.quote,
      f.sourceQuote || '',
      f.suggestion,
      f.editedSuggestion || '',
      f.status === 'approved' ? finalWording(f) : '',
      f.editedSuggestion ? `Yes (${f.editedByName || 'Reviewer'})` : 'No',
      f.status,
      decisionNames(f, 'approved'),
      decisionNames(f, 'rejected'),
      decisionNames(f, 'deferred'),
      f.providers.join(', '),
      f.disagreement ? 'Yes' : 'No',
      f.explanation,
      f.comments.map((c) => `${c.userName}: ${c.body}`).join(' | '),
    ]
      .map(csvEscape)
      .join(',')
  );

  return [headers.join(','), ...rows].join('\n') + '\n';
}

export function generateMarkdownExport(
  review: ReviewDTO,
  summary: ReviewSummaryDTO,
  findings: FindingDTO[],
  exportedBy: string,
  scope: 'all' | 'approved'
): string {
  const lines: string[] = [
    `# ${review.documentTitle || 'Document'}: Review Export`,
    '',
    review.documentSubtitle ? review.documentSubtitle : '',
    `Exported by ${exportedBy} on ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC.`,
    `Scope: ${scope === 'approved' ? 'Human-approved corrections only' : 'All findings (suggestions and human decisions separated)'}.`,
    '',
    '> Note: This report records automated review suggestions and human review decisions. It is not a modified copy of the original PDF and does not constitute legal or regulatory compliance certification.',
    '',
    '## Summary',
    '',
    `- Total findings: ${summary.totals.total}`,
    `- Approved by human reviewers: ${summary.totals.approved}`,
    `- Rejected: ${summary.totals.rejected}`,
    `- Deferred: ${summary.totals.deferred}`,
    `- Open / awaiting decision: ${summary.totals.open} (${summary.totals.split} split)`,
    `- Provider agreements: ${summary.totals.providerAgreements}, disagreements: ${summary.totals.providerDisagreements}`,
    `- Unresolved / ambiguous anchors: ${summary.totals.unresolvedAnchors}`,
    '',
  ];

  const approved = findings.filter((f) => f.status === 'approved');
  const others = findings.filter((f) => f.status !== 'approved');

  lines.push('## Human-Approved Corrections', '');
  if (!approved.length) {
    lines.push('No findings have been approved yet.', '');
  } else {
    for (const f of approved) {
      lines.push(
        `### ${f.key}: ${f.title} (Page ${f.page})`,
        `- Severity: ${f.severity} | Category: ${f.category} | Anchor: ${f.anchorStatus}`,
        `- Current text: ${f.quote}`,
        ...(f.sourceQuote ? [`- Source text: ${f.sourceQuote}`] : []),
        `- Approved final wording: ${finalWording(f)}${f.editedSuggestion ? ` (edited by ${f.editedByName || 'reviewer'})` : ''}`,
        `- Original tool suggestion: ${f.suggestion}`,
        `- Approved by: ${decisionNames(f, 'approved')}`,
        `- Detected by: ${f.providers.join(', ')}`,
        `- Explanation: ${f.explanation}`,
        ...(f.comments.length
          ? [`- Reviewer comments: ${f.comments.map((c) => `${c.userName}: ${c.body}`).join('; ')}`]
          : []),
        ''
      );
    }
  }

  if (scope === 'all') {
    lines.push('## Unapproved, Rejected, Deferred, and Open Suggestions', '');
    if (!others.length) {
      lines.push('All findings are approved.', '');
    } else {
      for (const f of others) {
        lines.push(
          `### ${f.key}: ${f.title} (Page ${f.page})`,
          `- Status: ${f.status} | Severity: ${f.severity} | Category: ${f.category} | Anchor: ${f.anchorStatus}`,
          `- Current text: ${f.quote}`,
          ...(f.sourceQuote ? [`- Source text: ${f.sourceQuote}`] : []),
          `- Unapproved tool suggestion: ${finalWording(f)}`,
          ...(decisionNames(f, 'rejected') ? [`- Rejected by: ${decisionNames(f, 'rejected')}`] : []),
          ...(decisionNames(f, 'deferred') ? [`- Deferred by: ${decisionNames(f, 'deferred')}`] : []),
          `- Detected by: ${f.providers.join(', ')}${f.disagreement ? ' (providers disagreed)' : ''}`,
          `- Explanation: ${f.explanation}`,
          ...(f.comments.length
            ? [`- Reviewer comments: ${f.comments.map((c) => `${c.userName}: ${c.body}`).join('; ')}`]
            : []),
          ''
        );
      }
    }
  }

  return lines.filter((l) => l !== undefined).join('\n');
}

export function generateJsonExport(
  review: ReviewDTO,
  summary: ReviewSummaryDTO,
  findings: FindingDTO[],
  exportedBy: string,
  scope: 'all' | 'approved'
): string {
  return JSON.stringify(
    {
      schemaVersion: '2.0',
      exportedAt: new Date().toISOString(),
      exportedBy,
      scope,
      notice:
        'Automated suggestions and human-approved corrections are stored separately. This export does not produce a modified PDF or certify legal compliance.',
      document: {
        id: review.documentId,
        title: review.documentTitle,
        subtitle: review.documentSubtitle,
        pageCount: review.pageCount,
        versionId: review.documentVersionId,
        sourceVersionId: review.sourceVersionId,
      },
      review: {
        id: review.id,
        reviewType: review.reviewType,
        status: review.status,
        config: review.config,
        completedAt: review.completedAt,
      },
      summary: summary.totals,
      approvedCorrections: findings
        .filter((f) => f.status === 'approved')
        .map((f) => ({
          key: f.key,
          page: f.page,
          severity: f.severity,
          category: f.category,
          anchorStatus: f.anchorStatus,
          quote: f.quote,
          sourceQuote: f.sourceQuote,
          approvedWording: finalWording(f),
          editedByHuman: Boolean(f.editedSuggestion),
          approvedBy: Object.values(f.activeDecisions)
            .filter((d) => d.verdict === 'approved')
            .map((d) => ({ user: d.userName, at: d.createdAt })),
          providers: f.providers,
          comments: f.comments,
        })),
      findings: findings.map((f) => ({
        key: f.key,
        page: f.page,
        severity: f.severity,
        category: f.category,
        title: f.title,
        quote: f.quote,
        sourceQuote: f.sourceQuote,
        toolSuggestion: f.suggestion,
        editedSuggestion: f.editedSuggestion,
        status: f.status,
        anchorStatus: f.anchorStatus,
        disagreement: f.disagreement,
        providers: f.providers,
        opinions: f.opinions,
        decisions: f.decisions,
        comments: f.comments,
        explanation: f.explanation,
      })),
    },
    null,
    2
  );
}

/**
 * Sanitizes text to WinAnsi-safe ASCII/Latin-1 characters for pdf-lib StandardFonts.
 */
function pdfSafe(s: string): string {
  return String(s || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u20ac/g, 'EUR ')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, ' ');
}

function wrapLines(text: string, maxChars: number): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export async function generatePdfReport(
  review: ReviewDTO,
  summary: ReviewSummaryDTO,
  findings: FindingDTO[],
  exportedBy: string,
  scope: 'all' | 'approved'
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 48;
  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - margin;

  const ink = rgb(0.09, 0.09, 0.11);
  const muted = rgb(0.4, 0.4, 0.43);
  const accent = rgb(0.02, 0.47, 0.34);
  const high = rgb(0.82, 0.18, 0.18);
  const lineCol = rgb(0.89, 0.89, 0.91);

  const ensureSpace = (needed: number) => {
    if (y - needed < margin + 24) {
      page = pdf.addPage([pageW, pageH]);
      y = pageH - margin;
    }
  };

  const drawTextLines = (
    text: string,
    opts: { size?: number; f?: typeof font; color?: typeof ink; maxChars?: number; x?: number } = {}
  ) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    const color = opts.color ?? ink;
    const x = opts.x ?? margin;
    const maxChars = opts.maxChars ?? Math.floor((pageW - x - margin) / (size * 0.52));
    for (const line of wrapLines(text, maxChars)) {
      ensureSpace(size + 5);
      page.drawText(line, { x, y, size, font: f, color });
      y -= size + 4;
    }
  };

  // Header
  drawTextLines('VIDIMUS REVIEW REPORT', { size: 9, f: bold, color: muted });
  y -= 2;
  drawTextLines(review.documentTitle || 'Document Review', { size: 18, f: bold, color: ink });
  if (review.documentSubtitle) {
    drawTextLines(review.documentSubtitle, { size: 10.5, color: muted });
  }
  drawTextLines(
    `Exported by ${exportedBy} on ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC | Scope: ${
      scope === 'approved' ? 'Approved only' : 'All findings'
    }`,
    { size: 9, color: muted }
  );
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: lineCol });
  y -= 14;

  // Disclaimer
  drawTextLines(
    'Notice: Machines analyze; humans decide. This report separates automated suggestions from human-approved corrections. It does not produce a modified source PDF or certify legal compliance.',
    { size: 8.5, color: muted }
  );
  y -= 8;

  // Summary block
  drawTextLines('Summary', { size: 12, f: bold, color: ink });
  drawTextLines(
    `Total findings: ${summary.totals.total}  |  Approved: ${summary.totals.approved}  |  Rejected: ${summary.totals.rejected}  |  Deferred: ${summary.totals.deferred}  |  Open: ${summary.totals.open} (${summary.totals.split} split)`,
    { size: 9.5, color: ink }
  );
  drawTextLines(
    `Severity: High ${summary.bySeverity.high}, Medium ${summary.bySeverity.medium}, Low ${summary.bySeverity.low}  |  Provider disagreements: ${summary.totals.providerDisagreements}`,
    { size: 9.5, color: muted }
  );
  y -= 10;

  // Findings list
  drawTextLines('Findings & Decisions', { size: 12, f: bold, color: ink });
  y -= 4;

  for (const f of findings) {
    ensureSpace(88);
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.6, color: lineCol });
    y -= 12;

    const statusCol = f.status === 'approved' ? accent : f.severity === 'high' ? high : muted;
    drawTextLines(`${f.key}  (Page ${f.page})  |  ${f.severity.toUpperCase()}  |  ${f.category}  |  Status: ${f.status.toUpperCase()}`, {
      size: 9,
      f: bold,
      color: statusCol,
    });
    drawTextLines(f.title, { size: 11, f: bold, color: ink });
    drawTextLines(`Current text: ${f.quote}`, { size: 9.5, color: muted });
    if (f.sourceQuote) {
      drawTextLines(`Source text: ${f.sourceQuote}`, { size: 9.5, color: muted });
    }
    const label = f.status === 'approved' ? 'Human-approved wording' : 'Unapproved suggestion';
    drawTextLines(`${label}: ${finalWording(f)}`, {
      size: 9.5,
      f: f.status === 'approved' ? bold : font,
      color: f.status === 'approved' ? accent : ink,
    });
    drawTextLines(`Explanation: ${f.explanation}`, { size: 9, color: muted });
    const app = decisionNames(f, 'approved');
    const rej = decisionNames(f, 'rejected');
    const def = decisionNames(f, 'deferred');
    const decSummary = [
      app ? `Approved by ${app}` : '',
      rej ? `Rejected by ${rej}` : '',
      def ? `Deferred by ${def}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    drawTextLines(
      `Providers: ${f.providers.join(', ')}  |  Decisions: ${decSummary || 'None yet'}`,
      { size: 8.5, color: muted }
    );
    y -= 6;
  }

  // Page numbers
  const pages = pdf.getPages();
  pages.forEach((p, idx) => {
    p.drawText(`Vidimus Review Report  |  Page ${idx + 1} of ${pages.length}`, {
      x: margin,
      y: 24,
      size: 8,
      font,
      color: muted,
    });
  });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
