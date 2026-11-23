import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ExportFormat, FindingDTO, ReviewSummaryDTO } from '@vidimus/shared';
import { api } from '../api/client';
import { AppShell } from '../components/AppShell';
import { Avatar, Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';

export function ExportPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useAuth();
  const [summary, setSummary] = useState<ReviewSummaryDTO | null>(null);
  const [findings, setFindings] = useState<FindingDTO[]>([]);
  const [scope, setScope] = useState<'all' | 'approved'>('all');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    Promise.all([api.reviewSummary(id), api.reviewFindings(id)])
      .then(([s, f]) => {
        if (!active) return;
        setSummary(s);
        setFindings(f.findings);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load export summary');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const rows = scope === 'approved' ? findings.filter((f) => f.status === 'approved') : findings;

  const handleDownload = async () => {
    if (!id) return;
    const url = api.exportUrl(id, format, scope);
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const nameMatch = cd.match(/filename="([^"]+)"/);
      const filename = nameMatch?.[1] || `vidimus-export.${format}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`Downloaded ${filename}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed');
    }
  };

  return (
    <AppShell
      crumb={
        <>
          <Link to="/documents">Documents</Link>
          <span className="cr-sep" aria-hidden="true">/</span>
          <b>{summary?.review.documentTitle || 'Review'}</b>
          <span className="cr-sub">Export</span>
        </>
      }
    >
      <main className="scroll-screen">
        <div className="page">
          <Link className="ex-back" to={`/reviews/${id}`}>
            <Icon name="arrow-left" />
            <span>Back to review desk</span>
          </Link>

          <div className="pg-head" style={{ marginBottom: 20 }}>
            <h1>Summary & export</h1>
            <p>
              {summary
                ? `${summary.review.documentTitle}${summary.review.documentSubtitle ? `, ${summary.review.documentSubtitle}` : ''}`
                : 'Loading review report...'}
            </p>
          </div>

          {error && (
            <div className="errbanner" role="alert">
              <Icon name="warning-circle" />
              <span>{error}</span>
            </div>
          )}

          {loading || !summary ? (
            <div className="dcard empty">
              <Icon name="circle-notch" className="spin" />
              <b>Preparing summary</b>
            </div>
          ) : (
            <>
              <div className="ex-stats">
                <div className="ex-stat">
                  <span>Findings</span>
                  <b>{summary.totals.total}</b>
                  <small>
                    {summary.totals.providerAgreements} agreed · {summary.totals.providerDisagreements} disagreed
                  </small>
                </div>
                <div className="ex-stat st-approved">
                  <span>Approved</span>
                  <b>{summary.totals.approved}</b>
                  <small>human-approved corrections</small>
                </div>
                <div className="ex-stat">
                  <span>Rejected & deferred</span>
                  <b>{summary.totals.rejected + summary.totals.deferred}</b>
                  <small>
                    {summary.totals.rejected} rejected, {summary.totals.deferred} deferred
                  </small>
                </div>
                <div className="ex-stat">
                  <span>Open</span>
                  <b>{summary.totals.open}</b>
                  <small>
                    {summary.totals.split ? `${summary.totals.split} split decisions` : 'awaiting human decision'}
                  </small>
                </div>
              </div>

              <div className="infobanner">
                <Icon name="file-text" />
                <span>
                  Exports strictly separate automated tool suggestions from human-approved corrections.
                  Vidimus exports a structured review record and does not alter the original source PDF.
                </span>
              </div>

              <div className="ex-panel">
                <div className="ex-bar">
                  <div className="ex-opt">
                    <span className="ex-label" id="exl-scope">
                      Include
                    </span>
                    <div className="seg" role="radiogroup" aria-labelledby="exl-scope">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={scope === 'all'}
                        onClick={() => setScope('all')}
                      >
                        All findings
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={scope === 'approved'}
                        onClick={() => setScope('approved')}
                      >
                        Approved only
                      </button>
                    </div>
                  </div>

                  <div className="ex-opt">
                    <span className="ex-label" id="exl-fmt">
                      Format
                    </span>
                    <div className="seg" role="radiogroup" aria-labelledby="exl-fmt">
                      {(
                        [
                          ['csv', 'CSV'],
                          ['md', 'Markdown'],
                          ['json', 'JSON'],
                          ['pdf', 'PDF Report'],
                        ] as const
                      ).map(([k, l]) => (
                        <button
                          key={k}
                          type="button"
                          role="radio"
                          aria-checked={format === k}
                          onClick={() => setFormat(k)}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn primary"
                    disabled={rows.length === 0}
                    onClick={handleDownload}
                  >
                    <Icon name="download-simple" />
                    <span>Download {format.toUpperCase()}</span>
                  </button>
                </div>

                <p className="ex-count">
                  {rows.length} {rows.length === 1 ? 'finding' : 'findings'} in this export, directly from persistent storage.
                </p>

                <div className="ex-tablewrap">
                  <table className="ex-table">
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Finding</th>
                        <th>Final wording</th>
                        <th>Status</th>
                        <th>Decided by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="ex-none">
                            No findings match this export scope.
                          </td>
                        </tr>
                      ) : (
                        rows.map((f) => {
                          const voters = Object.values(f.activeDecisions);
                          const finalText = f.editedSuggestion || f.suggestion;
                          return (
                            <tr key={f.id}>
                              <td className="ex-key">
                                <b>{f.key}</b>
                                <span>Page {f.page}</span>
                              </td>
                              <td className="ex-find">
                                <span className="ex-tags">
                                  <span className={`sevw s-${f.severity}`}>{f.severity}</span>
                                  <span>{f.category}</span>
                                </span>
                                <b>{f.title}</b>
                                <span className="ex-q">{f.quote}</span>
                              </td>
                              <td className="ex-final">
                                {finalText}
                                {f.editedSuggestion && (
                                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                                    Edited by {f.editedByName || 'reviewer'}
                                  </div>
                                )}
                              </td>
                              <td>
                                <span className={`stat st-${f.status}`}>{f.status}</span>
                              </td>
                              <td className="ex-by">
                                {voters.length ? (
                                  voters.map((v) => (
                                    <span key={v.id} className="ex-p">
                                      <Avatar
                                        name={v.userName}
                                        index={v.userAvatarIndex}
                                        size="xs"
                                        verdict={v.verdict}
                                      />
                                      {v.userName} <i>{v.verdict}</i>
                                    </span>
                                  ))
                                ) : (
                                  <span className="ex-none">Nobody yet</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}
