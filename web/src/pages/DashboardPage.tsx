import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DashboardDTO } from '@vidimus/shared';
import { api } from '../api/client';
import { AppShell } from '../components/AppShell';
import { Avatar, formatTimeAgo, Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function actionText(action: string, details: Record<string, unknown>): string {
  const key = details.key ? String(details.key) : '';
  if (action === 'decision.approved') return `approved ${key}`;
  if (action === 'decision.rejected') return `rejected ${key}`;
  if (action === 'decision.deferred') return `deferred ${key}`;
  if (action === 'decision.reopened') return `reopened ${key}`;
  if (action === 'suggestion.edited') return `edited the wording of ${key}`;
  if (action === 'comment.added') return `commented on ${key}`;
  if (action === 'document.uploaded') return `uploaded ${String(details.title || 'a document')}`;
  if (action === 'review.started') return `started a review on ${String(details.documentTitle || 'a document')}`;
  if (action === 'review.completed') return `completed analysis (${String(details.findingsCount ?? 0)} findings)`;
  if (action === 'review.exported') return `exported ${String(details.format || '').toUpperCase()} report`;
  if (action === 'auth.login') return 'signed in';
  return action.replace('.', ' ');
}

export function DashboardPage() {
  const { user, activeWorkspace } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [docSearch, setDocSearch] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .dashboard()
      .then((d) => {
        if (active) setData(d);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeWorkspace?.id]);

  const filteredDocs = useMemo(() => {
    if (!data) return [];
    const q = docSearch.trim().toLowerCase();
    if (!q) return data.recentDocuments;
    return data.recentDocuments.filter(
      (d) => d.title.toLowerCase().includes(q) || d.subtitle.toLowerCase().includes(q)
    );
  }, [data, docSearch]);

  const filteredActivity = useMemo(() => {
    if (!data) return [];
    return data.recentActivity.filter((ev) => ev.action !== 'auth.login').slice(0, 5);
  }, [data]);

  const firstName = user?.name.split(' ')[0] || 'Reviewer';
  const canEdit = activeWorkspace?.role !== 'viewer';

  return (
    <AppShell crumb={<b>Dashboard</b>}>
      <main className="dash-screen">
        <div className="dash-page">
          <div className="pg-head-row">
            <div className="pg-head">
              <h1>
                {greeting()}, {firstName}
              </h1>
              <p>
                {data
                  ? `${data.metrics.pendingDecisionsCount} ${
                      data.metrics.pendingDecisionsCount === 1 ? 'finding is' : 'findings are'
                    } awaiting human review in ${data.workspace.name}.`
                  : 'Loading workspace overview...'}
              </p>
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => navigate('/documents?upload=1')}
                >
                  <Icon name="plus" />
                  <span>Upload document</span>
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="errbanner" role="alert">
              <Icon name="warning-circle" />
              <span>{error}</span>
            </div>
          )}

          {loading && !data ? (
            <div className="dcard empty">
              <Icon name="circle-notch" className="spin" />
              <b>Loading workspace data</b>
              <span>Fetching documents, active reviews, and decisions.</span>
            </div>
          ) : data ? (
            <>
              <section className="dash-kpis" aria-label="Workspace metrics">
                <div className="kpi-card">
                  <span>Documents</span>
                  <div className="kpi-val">
                    <b>{data.metrics.documentsCount}</b>
                    <small>in workspace</small>
                  </div>
                </div>
                <div className="kpi-card">
                  <span>Active reviews</span>
                  <div className="kpi-val">
                    <b>{data.metrics.activeReviewsCount}</b>
                    <small>{data.metrics.completedReviewsCount} fully decided</small>
                  </div>
                </div>
                <div className="kpi-card">
                  <span>Pending decisions</span>
                  <div className="kpi-val">
                    <b>{data.metrics.pendingDecisionsCount}</b>
                    <small>awaiting review</small>
                  </div>
                </div>
                <div className={`kpi-card${data.metrics.highSeverityOpenCount > 0 ? ' kpi-high' : ' kpi-accent'}`}>
                  <span>High severity open</span>
                  <div className="kpi-val">
                    <b>{data.metrics.highSeverityOpenCount}</b>
                    <small>
                      {data.metrics.connectedProvidersCount}/{data.metrics.totalProvidersCount} providers ready
                    </small>
                  </div>
                </div>
              </section>

              <div className="dash">
                {/* Continue reviewing */}
                <section className="dcard dcont">
                  <span className="dlabel">Continue reviewing</span>
                  {data.continueReview ? (
                    (() => {
                      const rev = data.continueReview;
                      const total = rev.counts?.total || 0;
                      const decided = total - (rev.counts?.open || 0);
                      const pct = total ? Math.round((decided / total) * 100) : 0;
                      return (
                        <>
                          <h2>{rev.documentTitle}</h2>
                          <p className="dsub">
                            {rev.documentSubtitle || `${rev.reviewType} review`}
                          </p>
                          <div className="dprog">
                            <span className="bar">
                              <i style={{ width: `${pct}%` }} />
                            </span>
                            <span>
                              <b>{decided}</b> of {total} decided ({pct}%)
                            </span>
                          </div>
                          <div className="dsev">
                            <span>
                              <i className="dot s-high" />
                              High <b>{rev.counts?.high || 0}</b>
                              <small>open</small>
                            </span>
                            <span>
                              <i className="dot s-medium" />
                              Medium <b>{rev.counts?.medium || 0}</b>
                              <small>open</small>
                            </span>
                            <span>
                              <i className="dot s-low" />
                              Low <b>{rev.counts?.low || 0}</b>
                              <small>open</small>
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                            <Link className="btn primary" to={`/reviews/${rev.id}`}>
                              <span>Continue review</span>
                              <Icon name="arrow-right" />
                            </Link>
                            <Link className="btn" to={`/reviews/${rev.id}/export`}>
                              <Icon name="download-simple" />
                              <span>Summary & export</span>
                            </Link>
                          </div>
                        </>
                      );
                    })()
                  ) : (
                    <div className="empty" style={{ padding: '20px 8px' }}>
                      <Icon name="file-text" />
                      <b>No reviews started yet</b>
                      <span>Upload a PDF document and configure a review to get started.</span>
                      {canEdit && (
                        <button
                          type="button"
                          className="btn small primary"
                          onClick={() => navigate('/documents?upload=1')}
                        >
                          Upload first PDF
                        </button>
                      )}
                    </div>
                  )}
                </section>

                {/* Needs attention */}
                <section className="dcard">
                  <div className="dhead">
                    <h3>Requiring attention</h3>
                    <Link className="linkbtn" to="/reviews">
                      All reviews
                    </Link>
                  </div>
                  <div className="dash-scroll">
                    {data.attentionReviews.length === 0 ? (
                      <p className="dnone">
                        No high-severity findings, split decisions, or failed runs right now.
                      </p>
                    ) : (
                      <ul className="dlist2">
                        {data.attentionReviews.slice(0, 3).map((r) => (
                          <li key={r.id}>
                            <span className="dt">
                              <Link to={`/reviews/${r.id}`} style={{ textDecoration: 'none' }}>
                                <b>{r.documentTitle}</b>
                              </Link>
                              <span>
                                {r.status === 'failed'
                                  ? 'Analysis failed'
                                  : r.status === 'completed_with_errors'
                                    ? 'Completed with provider error'
                                    : `${r.counts?.high || 0} high open${
                                        (r.counts?.split || 0) > 0 ? `, ${r.counts?.split} split` : ''
                                      }`}
                              </span>
                            </span>
                            <Link className="btn small" to={`/reviews/${r.id}`}>
                              Open
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>

                {/* Recent activity */}
                <section className="dcard">
                  <div className="dhead">
                    <h3>Recent activity</h3>
                    <Link className="linkbtn" to="/reviews">
                      Full history
                    </Link>
                  </div>
                  <div className="dash-scroll">
                    {filteredActivity.length === 0 ? (
                      <p className="dnone">No review activity recorded yet.</p>
                    ) : (
                      <ul className="alist">
                        {filteredActivity.map((ev) => {
                          const reviewId = ev.details.reviewId ? String(ev.details.reviewId) : null;
                          const verdict = ev.action.startsWith('decision.')
                            ? ev.action.split('.')[1]
                            : undefined;
                          return (
                            <li key={ev.id}>
                              <Avatar
                                name={ev.actorName}
                                index={ev.actorAvatarIndex}
                                size="sm"
                                verdict={verdict}
                              />
                              <span className="atext">
                                <b>{ev.actorName}</b>{' '}
                                {reviewId ? (
                                  <Link to={`/reviews/${reviewId}`}>
                                    {actionText(ev.action, ev.details)}
                                  </Link>
                                ) : (
                                  actionText(ev.action, ev.details)
                                )}
                                {typeof ev.details.title === 'string' && ev.details.title && (
                                  <span className="atitle">{ev.details.title}</span>
                                )}
                              </span>
                              <time>{formatTimeAgo(ev.createdAt)}</time>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </section>

                {/* Recent documents with inline search */}
                <section className="dcard">
                  <div className="dhead">
                    <h3>Documents</h3>
                    <Link className="linkbtn" to="/documents">
                      All documents
                    </Link>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <input
                      className="input"
                      type="search"
                      placeholder="Filter recent documents..."
                      aria-label="Filter recent documents"
                      value={docSearch}
                      onChange={(e) => setDocSearch(e.target.value)}
                      style={{ padding: '6px 10px' }}
                    />
                  </div>
                  <div className="dash-scroll">
                    {filteredDocs.length === 0 ? (
                      <p className="dnone">No documents match your filter.</p>
                    ) : (
                      <ul className="dlist2">
                        {filteredDocs.slice(0, 4).map((d) => (
                          <li key={d.id}>
                            <span className="dt">
                              <b>{d.title}</b>
                              <span>
                                {d.latestVersion?.pageCount || 0} pages ·{' '}
                                {d.kind === 'translation'
                                  ? `${d.sourceLang.toUpperCase()} to ${(d.targetLang || '').toUpperCase()}`
                                  : d.sourceLang.toUpperCase()}
                              </span>
                            </span>
                            <span className="dn">
                              {d.findingsCount
                                ? `${d.decidedCount}/${d.findingsCount}`
                                : d.latestVersion?.extractionStatus === 'ocr_required'
                                  ? 'OCR needed'
                                  : 'Ready'}
                            </span>
                            <Link
                              className="btn small"
                              to={
                                d.latestReviewId
                                  ? `/reviews/${d.latestReviewId}`
                                  : `/documents/${d.id}/configure`
                              }
                            >
                              {d.latestReviewId ? 'Review' : 'Configure'}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </div>
            </>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}
